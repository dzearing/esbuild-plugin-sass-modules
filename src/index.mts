import sass from "sass";
import path from "path";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import modules from "postcss-modules";

import fs from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { readFile } = fs.promises;
const pathLookups = {};

/**
 * Parses a given package import path string into { packageName, filePath }.
 * Note: if a filePath does not exist, filePath will be null. If it is defined, it will
 * contain a "/" prefix.
 */
function parseImportPath(importPath) {
  const [_, packageName, filePath] = importPath.match(
    /(@[0-9a-zA-Z-]+\/[0-9a-zA-Z-]+|[0-9a-zA-Z-]+)(\/[a-zA-Z.\/\-_0-9]+|)/
  );

  return { packageName, filePath };
}

const resolveSassImport = (url, resolveMap) => {
  if (pathLookups[url]) {
    return { file: pathLookups[url] };
  }

  let packageImportPath;

  if (url[0] === "~") {
    packageImportPath = url.substr(1);
  } else if (url[0] !== ".") {
    packageImportPath = url;
  }

  if (packageImportPath) {
    const { packageName, filePath } = parseImportPath(packageImportPath);
    if (!resolveMap[packageName]) {
      throw new Error(
        `SASS: The package ${packageName} was not in the resolveMap!`
      );
    }

    console.log(
      `SASS: Trying to resolve "${url}", packageName: "${packageName}", packageImportPath="${packageImportPath}", resolveMap="${JSON.stringify(
        resolveMap[packageName],
        null,
        2
      )}"`
    );

    const resolvedPath = (Object.entries(
      resolveMap[packageName] || {}
    )[0]?.[1] || "") as string;
    const newPath = path.join(resolvedPath, filePath.replace("/lib/", "/src/"));

    console.log(`Translated ${packageName}${filePath} to "${newPath}"`);
    pathLookups[url] = newPath;

    return { file: newPath };
  }

  return null;
};

function renderSass(filePath, resolveMap) {
  return sass
    .renderSync({
      file: filePath,
      importer: (url) => resolveSassImport(url, resolveMap),
    })
    .css.toString();
}

async function parseModules(content, filePath) {
  let moduleMap = {};
  const result = await postcss([
    autoprefixer,
    modules({
      getJSON: (filename, json) => {
        moduleMap = json;
      },
    }),
  ]).process(content);

  console.log(
    `postcss processing:\nmodules:\n${JSON.stringify(
      moduleMap,
      null,
      2
    )}\ncss:\n${result.css}\n`
  );

  return {
    css: result.css,
    moduleMap,
  };
}

function createLoader(content, modules) {
  let result = [
    `import loadStylesheet from 'esbuild-plugin-sass-modules/lib/loadStylesheet';`,
    `export const _stylesheet = ${JSON.stringify(content)};`,
  ];

  if (modules) {
    for (const [name, value] of Object.entries(modules)) {
      result.push(`export const ${name} = "${value}"`);
    }

    result.push(
      `const _defaultExport = {${Object.keys(modules).join(", ")}};`,
      ``,
      `export default _defaultExport;`,
      ``
    );
  }

  result.push(`loadStylesheet(_stylesheet);`);

  return result.join(`\n`);
}

export interface SassModulePluginOptions {
  resolveMap?: {
    [packageName: string]: {
      [version: string]: string;
    };
  };
}

const sassModulePlugin = (options: SassModulePluginOptions = {}) => ({
  name: "sass",
  setup: async function (build) {
    const { resolveMap } = options;

    build.onResolve(
      {
        filter: /esbuild-plugin-sass-modules\/lib\/loadStylesheet/,
        namespace: "file",
      },
      () => ({
        path: path.join(__dirname, "loadStylesheet.js"),
      })
    );

    build.onLoad(
      { filter: /.\.(sass|scss|css)$/, namespace: "file" },
      async (args) => {
        const isSass = !!args.path.match(/.\.(sass|scss)$/);
        const isModule = true; // !!args.path.match(/\.module\./);
        let cssContent: string = isSass
          ? renderSass(args.path, resolveMap)
          : (await readFile(args.path, "utf8")).toString();
        // return { contents: cssContent };
        let moduleMap: Record<string, string> | undefined = undefined;

        // If this is a module, update the content and prepare a module mop.
        if (isModule) {
          const result = await parseModules(cssContent, args.path);

          cssContent = result.css;
          moduleMap = result.moduleMap;
        }

        return {
          contents: createLoader(cssContent, moduleMap),
          loader: "js",
        };
      }
    );
  },
});

export default sassModulePlugin;
