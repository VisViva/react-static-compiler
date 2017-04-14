/**
 * Libraries
 */

import path from 'path';
import fs from 'fs';
import vm from 'vm';
import React from 'react';
import Promise from 'bluebird';
import { jsdom, evalVMScript } from 'jsdom';

/**
 * Plugins
 */

import SingleEntryPlugin from 'webpack/lib/SingleEntryPlugin';

/**
 * Extraneous assets that are not needed in the final build
 */

let extraneousAssets = [];

/**
 * Get paths from the extract text webpack plugin
 */

const getExtractTextPluginPaths = (compilation) => {
    const { options, context } = compilation.compiler;
    const paths = new Set();

    if (context) {
        paths.add(path.resolve(context, './node_modules/extract-text-webpack-plugin'));
    }

    if (options && options.context) {
        paths.add(path.resolve(options.context, './node_modules/extract-text-webpack-plugin'));
    }

    try {
        if (options.resolve.modules && options.resolve.modules.length) {
            options.resolve.modules.forEach(x => {
                paths.add(path.resolve(x, './extract-text-webpack-plugin'));
            });
        }
    } catch (err) {
        error('Error resolving options.resolve.modules');
    }

    try {
        if (options.resolveLoader.modules && options.resolveLoader.modules.length) {
            options.resolveLoader.modules.forEach(x => {
                paths.add(path.resolve(x, './extract-text-webpack-plugin'));
            });
        }
    } catch (err) {
        error('Error resolving options.resolveLoader.modules');
    }

    return Array.from(paths).filter(fs.existsSync);
};

/**
 * Loggers
 */

export const log = (message) => {
    console.log('\x1b[0m%s\x1b[0m: ', `---   : ${message}`);
}

export const warning = (message) => {
    console.log('\x1b[33m%s\x1b[0m: ', `--- ! : ${message}`);
}

export const error = (message) => {
    console.log('\x1b[31m%s\x1b[0m: ', `--- x : ${message}`);
}

export const success = (message) => {
    console.log('\x1b[32m%s\x1b[0m: ', `--- > : ${message}`);
}

/**
 * Delete folder recursively
 */

export const deleteFolderRecursively = (path) => {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function(file, index) {
            var curPath = path + '/' + file;
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
};

/**
 * Get the name of the function
 *
 *  Matching:
 *  - ^          the beginning of the string
 *  - function   the word 'function'
 *  - \s+        at least some white space
 *  - ([\w\$]+)  capture one or more valid JavaScript identifier characters
 *  - \s*        optionally followed by white space (in theory there won't be any here,
 *               so if performance is an issue this can be omitted[1]
 *  - \(         followed by an opening brace
 */

export const functionName = (func) => {
    const result = /^function\s+([\w\$]+)\s*\(/.exec(func.toString())
    return result && result[1] || '';
}

/**
 * Strip outer wrappers of the component:
 *
 * 'Connect(App)' -> 'App'
 */

export const stripComponentWrappers = (name) => {
    if (name && name.indexOf('(') > -1) {
        return name.match(/\(((?:|[^()])+)\)/)[1];
    } else {
        return name;
    }
}

/**
 * Assemble component tree, by traversing the routes module provided
 * as a path to the plugin
 */

export const assembleComponentTree = (component) => {
    let tree;
    if (component.type.displayName === 'Route') {
        tree = {};
        if (component.props.component) {
            tree.component = component.props.component;
        }
        if (component.props.children) {
            component.props.children.map(child => {
                tree.children = tree.children || [];
                const children = assembleComponentTree(child);
                if (children) tree.children.push(children);
            });
        }
    }
    return tree;
}

/**
 * Generate assets which consist of an array of components in the
 * order of nesting and a full concatenated path
 */

export const assembleAssets = (tree, child) => {
    let assets = [];
    const displayName = stripComponentWrappers(tree.component.displayName || functionName(tree.component));

    if (tree.children) {
        tree.children.map(node => {
            assembleAssets(node, true).map(asset => {
                assets.push({
                    components: [tree.component, ...(asset.components)],
                    path: displayName + '/' + asset.path
                });
            });
        });
    } else {
        assets.push({
            components: [tree.component],
            path: displayName + '.html'
        });
    }

    return child && assets || assets.map(asset => {
        return {
            components: asset.components,
            path: `./${asset.path}`
        };
    });
}

/**
 * Given a template, inject resources such as styles, scripts and
 * pre-rendered markup
 */

export const injectResources = (template, prefix, postfix, markup, page) => {
    return template
        .replace(
            '<!-- Styles -->',
            `<link href="${prefix}styles-${postfix}.css" rel="stylesheet" type="text/css">`
        ).replace(
            '<!-- Application -->',
            markup
        ).replace(
            '<!-- Scripts -->',
            `<script src="${prefix}vendor-${postfix}.js"></script>
            <script src="${prefix}${page}-${postfix}.js"></script>`
        );
}

/**
 * Generate jsx markup from an array of react components
 * The innermost component is supposed to be the last in the list
 */

export const assembleNestedComponent = (components) => {
    let Component, markup;
    for (let i = components.length - 1; i >= 0; --i) {
        if (Component) {
            Component = components[i];
            markup = (<Component>{markup}</Component>);
        } else {
            Component = components[i];
            markup = (<Component/>);
        }
    }
    log(markup)
    return markup;
}

/**
 * Generate a jsx string markup from an array of react components for
 * the injection purposes. The innermost component is supposed to be
 * the last in the list
 */
export const assembleNestedComponentAsJsxString = (components) => {
    let jsxString;
    for (let i = components.length - 1; i >= 0; --i) {
        const displayName = stripComponentWrappers(components[i].displayName || functionName(components[i]));
        if (jsxString) {
            jsxString = `<${displayName}>${jsxString}</${displayName}>`;
        } else {
            jsxString = `<${displayName}/>`;
        }
    }
    return jsxString;
}

/**
 * Generate a jsx string markup from an array of react components
 * The innermost component is supposed to be the last in the list
 */

export const ensureDirectoryExistence = (filePath) => {
    var dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

/**
 * Get the array of extraneous assets
 */

export const getExtraneousAssets = () => extraneousAssets;

/**
 * Compile an asset using chain of webpack loaders
 *
 * This function is shamelessly borrowed from an awesome npm module
 * https://github.com/iansinnott/react-static-webpack-plugin
 * developed by Ian Sinnott (ian@iansinnott.com)
 */

export const compileAsset = (options) => {

    /**
     * Retrieving options
     */

    const { filepath, outputFilename, compilation, context, template } = options;

    /**
     * Setting up webpack compiler
     */

    const compilerName = `Compiling "${filepath}"`;
    const outputOptions = {
        filename: outputFilename,
        publicPath: compilation.outputOptions.publicPath,
    };
    let rawAssets = {};

    success(`Compilation context "${context}"`);
    success(`Compiling "${path.resolve(context, filepath)}"`);

    const childCompiler = compilation.createChildCompiler(compilerName, outputOptions);
    childCompiler.apply(new SingleEntryPlugin(context, filepath));
    childCompiler.plugin('this-compilation', (compilation) => {
        const extractTextPluginPaths = getExtractTextPluginPaths(compilation);
        log('Patching ExtractTextPluginPaths', extractTextPluginPaths);
        compilation.plugin('normal-module-loader', (loaderContext) => {
            extractTextPluginPaths.forEach(x => {
                loaderContext[x] = (content, opt) => {
                    return true;
                };
            });
        });
        compilation.plugin('optimize-chunk-assets', (chunks, callback) => {
            const files: string[] = [];
            chunks.forEach((chunk) => {
                chunk.files.forEach((file) => files.push(file));
            });
            compilation.additionalChunkAssets.forEach((file) => files.push(file));
            rawAssets = files.reduce((agg, file) => {
                agg[file] = compilation.assets[file];
                return agg;
            }, {});
            extraneousAssets = [...extraneousAssets, ...files];
            callback();
        });
    });

    return new Promise((resolve, reject) => {
            childCompiler.runAsChild(function(err, entries, childCompilation) {
                if (err) {
                    error('Error during compilation: ', err);
                    reject(err);
                }
                if (childCompilation.errors && childCompilation.errors.length) {
                    const errorDetails = childCompilation.errors.map((err) => {
                        return err.message + (err.error ? ':\n' + err.error : '');
                    }).join('\n');
                    reject(new Error('Child compilation failed:\n' + errorDetails));
                } else {
                    let asset = compilation.assets[outputFilename];
                    if (rawAssets[outputFilename]) {
                        warning(`Using raw source for ${filepath}`);
                        asset = rawAssets[outputFilename];
                    }
                    resolve(asset);
                }
            });
        })
        .then((asset) => {
            if (asset instanceof Error) {
                error(`File ${filepath} failed to compile`);
                return Promise.reject(asset);
            }
            success(`File  ${filepath} compiled successfully`);
            const doc = jsdom(template);
            const win = doc.defaultView;
            const script = new vm.Script(asset.source(), {
                filename: filepath,
                displayErrors: true
            });
            return evalVMScript(win, script);
        })
        .catch((err) => {
            error(`File ${filepath} failed to process`);
            return Promise.reject(err);
        });
};
