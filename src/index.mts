import sass from "sass";
import path from "path";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import modules from "postcss-modules";
import resolve from 'resolve'
import fs from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

export type ResolveMap = {
  [packageName: string]: {
    path: string;
  }
};
export interface SassModulePluginOptions {
  resolveMap?: ResolveMap;
}

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

const resolveSassImport = (url: string, originalPath: string, resolveMap?: ResolveMap): null | { file: string; } => {
  console.log(`resolveSassImport, ${url}, ${originalPath}, ${JSON.stringify(resolveMap, null, 2)}`);
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
    const resolvedPath = resolveMap?.[packageName]?.path || path.dirname(resolve.sync(packageName + '/package.json', { basedir: path.dirname(originalPath) }));

    console.log(
      `SASS: Trying to resolve "${url}", packageName: "${packageName}", packageImportPath="${packageImportPath}", resolvedPath="${JSON.stringify(
        resolvedPath,
        null,
        2
      )}"`
    );

    
 
    const newPath = path.join(resolvedPath, filePath.replace("/lib/", "/src/"));

    console.log(`Translated ${packageName}${filePath} to "${newPath}"`);
    pathLookups[url] = newPath;

    return { file: newPath };
  }

  return null;
};

function renderSass(filePath: string, resolveMap?: ResolveMap): string {
  console.log(`SASS: RENDERING SASS`, filePath);
  return sass
    .renderSync({
      file: filePath,
      importer: (url) => resolveSassImport(url, filePath, resolveMap),
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
        const isModule = !args.path.match(/\.global\./);

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
