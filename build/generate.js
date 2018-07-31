#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const got = require("got");
const parse5 = require("parse5");
const path = require("path");
const urlToolkit = require("url-toolkit");

const structure = require("./structure");
const {cleanUp, extractColors, replaceClosest, finalize} = require("./process");

// list of URLs to pull stylesheets from
const urls = [
  {url: "https://github.com"},
  {url: "https://gist.github.com"},
  {url: "https://help.github.com"},
  // {url: "https://github.com/login", opts: {headers: {"User-Agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Mobile Safari/537.36"}}},
];

const folder = path.join(__dirname, "..");
const cssFile = path.join(folder, "github-dark.user.css");

(async () => {
  try {
    const links = extractStyleLinks(await Promise.all(urls.map(u => got(u.url, u.opts))));
    const responses = await Promise.all(links.map(link => got(link)));
    const colorsOnly = extractColors(responses.map(res => res.body).join("\n"));
    const {root, file} = replaceClosest(colorsOnly);
    await fs.writeFile(path.join(folder, "src", "_root.css"), root);
    await fs.writeFile(path.join(folder, "src", "_temp_before.css"), colorsOnly);
    await fs.writeFile(path.join(folder, "src", "_temp.css"), cleanUp(file));
    writeOutput();
  } catch (err) {
    exit(err);
  }
})();

async function writeOutput() {
  const order = [];
  const dir = await fs.readdir(path.join(folder, "src"));
  const len = dir.length;
  const struct = structure.map(file => new RegExp(`^${file.includes("*") ? file.replace(/\*/g, ".*") : file}$`, "i"));
  let f, i;
  let index = 0;
  while (dir.length && index < len) {
    const ln = dir.length;
    for (i = 0; i < ln; i++) {
      f = dir.shift();
      if (struct[index] && struct[index].test(f)) {
        order.push(f);
      } else {
        dir.push(f);
      }
    }
    index++;
  }
  const file = await Promise.all(
    order.map((f, indx) =>
      // Include file name as a comment (except for intro.css)
      (indx > 0 ? `/*** FILE: ${f.toUpperCase()} ***/\n` : "") +
      fs.readFileSync(path.join(folder, "src", f), "utf8")
    )
  );
  await fs.writeFile(cssFile, finalize(file));
  // await fs.unlink(path.join(folder, "src", "_root.css"));
  // await fs.unlink(path.join(folder, "src", "_temp.css"));
}

function extractStyleLinks(responses) {
  const styleUrls = [];
  responses.forEach(res => {
    extractStyleHrefs(res.body).forEach(href => {
      styleUrls.push(urlToolkit.buildAbsoluteURL(res.requestUrl, href));
    });
  });
  return styleUrls;
}

function extractStyleHrefs(html) {
  return (html.match(/<link.+?>/g) || []).map(link => {
    const attrs = {};
    parse5.parseFragment(link).childNodes[0].attrs.forEach(attr => {
      attrs[attr.name] = attr.value;
    });
    if (attrs.rel === "stylesheet" && attrs.href) {
      return attrs.href;
    }
  }).filter(link => !!link);
}

function exit(err) {
  if (err) console.error(err.message);
  process.exit(err ? 1 : 0);
}
