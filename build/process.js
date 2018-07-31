#!/usr/bin/env node
"use strict";

const postcss = require("postcss");
const colorsOnly = require("postcss-colors-only");
const mergeRules = require("postcss-merge-rules");
const joinArray = require("join-non-empty-array");
const Color = require("color");
const nearestColor = require("nearest-color");
const perfectionist = require("perfectionist");

const pkg = require("../package.json");
const palette = require("./palette");

// Replace hex 6 before hex 3 to prevent global replace issues
const regexp1 = /(#[a-f0-9]{6}|rgba\([\s\d,.]+?\))/gmi; // |white|black|silver|blue
const regexp2 = /(#[a-f0-9]{3})/gmi;

const colorsOnlyOptions = {
  withoutGrey: false, // set to true to remove rules that only have grey colors
  withoutMonochrome: false, // set to true to remove rules that only have grey, black, or white colors
  inverse: false // set to true to remove colors from rules
};

// list of regexes matching selectors that should be ignored
const ignoreSelectors = [
  /^\.Header/, // Header is already dark
  /^\.CodeMirror/,
  /^\.cm-/, // CodeMirror
  /^\.pl-/, // GitHub Pretty Lights Syntax highlighter
  /\spre$/,
  /^(a:visited|a)$/ // overrides base color
];

const replacements = {
  "box-shadow": {
    regex: /box-shadow[\s\S]+/,
    repl: ""
  },
  "text-shadow": {
    regex: /text-shadow[\s\S]+/,
    repl: ""
  },
  // border-color: 0
  "0": {
    regex: /[\s\S]+color:\s*0\s*(!important)?;?/,
    repl: ""
  }
};

const perfOpts = {
  maxSelectorLength: 76, // -4 because of indentation and to accomodate ' {'
  indentSize: 2,
};

// Make GitHub's color choice dark... invert & hue rotate
// https://github.com/Qix-/color#manipulation
function processColor(color) {
  return Color(color).negate().rotate(180).lighten(.2);
}

function extractColors(file) {
  return postcss()
    .use(colorsOnly(colorsOnlyOptions))
    .process(file)
    .css;
}

function getRGBFromColor(color) {
  // color.rgb => [0, 0, 9.99999999, 1] (don't need alpha channel)
  return color.rgb().array().slice(0, 3).map(n => Math.round(n)).join(", ");
}

function escapeString(str) {
  return str.replace(/([.?*+$\[\]\/\\(){}|\-])/g, "\\$1");
}

function replaceClosest(file) {
  let root = new Set(Object.keys(palette.colors).map(k => `--${k}: ${palette.colors[k]};`));
  ({file, root} = replaceBaseColor(file, root));
  ({file, root} = replaceClosestColors(file, root));
  return {root: `:root {\n\t${Array.from(root).join("\n\t")}\n}`, file};
}

function replaceBaseColor(file, root) {
  root.add("--base-color: /*[[base-color]]*/;");
  palette.base.forEach(color => {
    file = file.replace(new RegExp(escapeString(color), "gmi"), "var(--base-color)");
  });
  return {root, file};
}

function replaceClosestColors(file, root) {
  const nearest = nearestColor.from(palette.colors);
  new Set([...file.match(regexp1), ...file.match(regexp2)]).forEach(c => {
    const near = nearest(processColor(c).hex().replace("0x", "#"));
    const nearColor = Color(near.value);
    let color;
    if (c.startsWith("rgba")) {
      let name = `--${near.name}-rgb`;
      color = `rgba(var(${name}), ${c.split(",").pop()}`;
      root.add(`${name}: ${getRGBFromColor(nearColor)};`);
    } else {
      color = `var(--${near.name})`;
    }
    file = file.replace(new RegExp(escapeString(c), "gmi"), color);
  });
  return {root, file};
}

function joinNoEmpties(arry, joiner) {
  return joinArray(arry, joiner, {trimEntries: true}).trim();
}

function cleanUp(file) {
  file = String(perfectionist.process(file, Object.assign(perfOpts, {format: "compact"})))
    .split("\n")
    .map(line => {
      let [selectors, def] = line.split(/[{}]/);
      // Remove ignored selectors
      selectors = selectors.split(/\s*,\s*/).filter(s => !ignoreSelectors.some(regex => regex.test(s)));
      // eslint-disable-next-line arrow-body-style
      def = (def || "").split(/\s*;\s*/).map(d => {
        return Object.keys(replacements).map(r => {
          if (replacements[r].regex.test(d)) {
            return d.replace(replacements[r].regex, replacements[r].repl);
          }
          return d;
        })[0];
      });
      selectors = joinNoEmpties(selectors, ", ");
      def = joinNoEmpties(def, "; ");
      if (selectors && def) {
        return `${selectors} { ${def}; }`;
      }
      return "";
    });
  const result = String(perfectionist.process(joinNoEmpties(file, "\n"), perfOpts));
  // Uncomment this if there is a <css input>... Unknown word error
  // return result;
  return postcss()
    .use(mergeRules())
    .process(result)
    .css;
}

function finalize(file) {
  return file.map((section, index) => {
    if (index === 0) {
      return section.replace("{{version}}", pkg.version);
    } else if (index > 1) {
      return section.replace(/(\s*!important)?\s*;/g, " !important;");
    }
    // Don't add "!important" to :root {} definitions
    return section;
  })
  .join("\n");
}

module.exports = {
  cleanUp,
  extractColors,
  finalize,
  replaceClosest
};
