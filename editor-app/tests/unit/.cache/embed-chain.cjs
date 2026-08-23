"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/editor/ref/embed-chain.ts
var embed_chain_exports = {};
__export(embed_chain_exports, {
  MAX_EMBED_DEPTH: () => MAX_EMBED_DEPTH,
  buildCollapseChain: () => buildCollapseChain,
  chainKey: () => chainKey,
  chainLabel: () => chainLabel,
  classifyEmbed: () => classifyEmbed,
  collapseSummary: () => collapseSummary
});
module.exports = __toCommonJS(embed_chain_exports);
var MAX_EMBED_DEPTH = 10;
function chainKey(realPath) {
  return realPath.replace(/\\/g, "/").toLowerCase();
}
function classifyEmbed(ancestors, realPath) {
  const self = chainKey(realPath);
  const hit = ancestors.find((a) => chainKey(a) === self);
  if (hit !== void 0) return { kind: "cycle", hit };
  const depth = ancestors.length - 1;
  if (depth >= MAX_EMBED_DEPTH) return { kind: "too-deep", limit: MAX_EMBED_DEPTH };
  return { kind: "ok" };
}
function buildCollapseChain(ancestors, selfReal) {
  return [...ancestors, selfReal];
}
function collapseSummary(verdict, path) {
  if (verdict.kind === "cycle") return `\u5FAA\u73AF\u5F15\u7528\uFF1A[[${path}]] \u5DF2\u5728\u4E0A\u7EA7\u5C42\u7EA7\u51FA\u73B0\uFF0C\u5DF2\u6298\u53E0`;
  return `\u5D4C\u5957\u5C42\u7EA7\u8D85\u8FC7 ${MAX_EMBED_DEPTH} \u5C42\uFF0C\u5DF2\u6298\u53E0`;
}
function chainLabel(ancestors, leaf) {
  const short = (p) => {
    const name = p.split("/").pop() || p;
    return name.length > 18 ? name.slice(0, 17) + "\u2026" : name;
  };
  return buildCollapseChain(ancestors, leaf).map(short).join(" \u203A ");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_EMBED_DEPTH,
  buildCollapseChain,
  chainKey,
  chainLabel,
  classifyEmbed,
  collapseSummary
});
