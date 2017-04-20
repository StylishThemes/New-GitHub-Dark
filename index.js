#!/usr/bin/env node
"use strict";

const async      = require("async");
const chalk      = require("chalk");
const got        = require("got");
const handlebars = require("handlebars");
const parseCss   = require("css").parse;
const parseHtml  = require("parse5").parseFragment;
const perf       = require("perfectionist").process;
const timestamp  = require("time-stamp");
const fs         = require("fs");
const path       = require("path");

const template = String(fs.readFileSync(path.join(__dirname, "template.hbs")));

const sites = [
  "github.com",
  "gist.github.com",
  "guides.github.com",
  "help.github.com",
  "status.github.com",
  "developer.github.com",
];

const mappings = {
  "color: #444d56": "color: #ccc !important",
  "color: #586069": "color: #bbb !important",
  "color: #6a737d": "color: #aaa !important",
};

const perfOpts = {
  maxSelectorLength: 76,
  indentSize: 2,
};

async.map(sites, getDeclarations, function(err, results) {
  if (err) exit(err);
  results = results.map(generateRules);

  // write out individual files
  results.forEach(function(result) {
    const name = result.site.replace(/^https?:\/\//, "") + ".css";
    const file = path.join(__dirname, "sites", name);
    fs.writeFileSync(file, result.css);
  });

  // build github-dark.css from template
  var templateData = {};
  results.forEach(result => {
    templateData[result.site] = result.css.split("\n").map((line, i) => {
      if (i === 0) return line;
      return " ".repeat(4) + line;
    }).join("\n").trim();
  });
  var combined = handlebars.compile(template)(templateData);
  fs.writeFileSync(path.join(__dirname, "github-dark.css"), combined);
  log("Saved", chalk.green("github-dark.css"));
});

function getDeclarations(url, cb) {
  log(`Pulling declarations from ${chalk.blue(url)}`);
  pullCss("https://" + url, function(css) {
    const decls = [];
    parseCss(css).stylesheet.rules.forEach(function(rule) {
      if (!rule.selectors || rule.selectors.length === 0) return;
      rule.declarations.forEach(decl => {
        Object.keys(mappings).forEach(function(mapping) {
          const [prop, val] = mapping.split(": ");
          if (decl.property === prop && decl.value.toLowerCase() === val.toLowerCase()) {
            if (!decls[mapping]) decls[mapping] = [];
            rule.selectors.forEach(selector => {
              // TODO: create separate rules for each vendor-prefixed
              // rule because putting them together with other rules
              // would create invalid rules. Skipping them for now.
              if (selector[0] === ":") return;
              decls[mapping].push(selector);
            });
          }
        });
      });
    });
    log(`Got declarations from ${chalk.blue(url)}`);
    cb(null, {site: url, decls: decls});
  });
}

function generateRules(result) {
  var css = "";
  Object.keys(result.decls).forEach(function(decl) {
    css += `/* "${decl}" -> "${mappings[decl]}" */\n`;

    // sort selectors
    const selectors = result.decls[decl].sort((a, b) => {
      return a.localeCompare(b);
    }).join(",");

    css += String(perf(selectors + "{" + mappings[decl] + "}", perfOpts));
  });
  return Object.assign(result, {css: css});
}

function pullCss(url, cb) {
  got(url).then(res => {
    var links = res.body.match(/<link.+>/g) || [];
    links = links.map(link => {
      const attrs = {};
      parseHtml(link).childNodes[0].attrs.forEach(function(attr) {
        attrs[attr.name] = attr.value;
      });
      if (attrs.rel === "stylesheet" && attrs.href) {
        return attrs.href;
      }
    }).filter(link => !!link);
    async.map(links, (link, cb) => {
      const uri = /^http/.test(link) ? link : url + link;
      got(uri).then(res => {
        cb(null, res.body);
      });
    }, function(_, css) {
      cb(css.join("\n"));
    });
  }).catch(err => cb(err));
}

function log(...args) {
  console.log(timestamp("YYYY-MM-DD HH:mm:ss"), ...args);
}

function exit(err) {
  if (err) console.error(err);
  process.exit(err ? 1 : 0);
}
