#!/usr/bin/env node
const fs = require("fs");
const juice = require("juice");
const SVGO = require("svgo");
const { spawnSync } = require("child_process");

function run(cmd, args) {
  const result = spawnSync(cmd, args);
  if (result.status !== 0) {
    console.log(result.stdout.toString("utf8"));
    console.log(result.stderr.toString("utf8"));
    console.log(result.status);
    process.exit(1);
  }
}

async function main() {
  for (const file of [
    "logo.optimized.svg",
  ]) {
    const svgo = new SVGO({
      plugins: [
        {
          cleanupAttrs: true,
        },
        {
          removeDoctype: false,
        },
        {
          removeXMLProcInst: false,
        },
        {
          removeComments: false,
        },
        {
          removeMetadata: true,
        },
        {
          removeTitle: true,
        },
        {
          removeDesc: true,
        },
        {
          removeUselessDefs: true,
        },
        {
          removeEditorsNSData: true,
        },
        {
          removeEmptyAttrs: true,
        },
        {
          removeHiddenElems: true,
        },
        {
          removeEmptyText: true,
        },
        {
          removeEmptyContainers: true,
        },
        {
          removeViewBox: false,
        },
        {
          cleanupEnableBackground: true,
        },
        {
          convertStyleToAttrs: true,
        },
        {
          convertColors: true,
        },
        {
          convertPathData: true,
        },
        {
          convertTransform: true,
        },
        {
          removeUnknownsAndDefaults: true,
        },
        {
          removeNonInheritableGroupAttrs: true,
        },
        {
          removeUselessStrokeAndFill: true,
        },
        {
          removeUnusedNS: true,
        },
        {
          cleanupIDs: true,
        },
        {
          cleanupNumericValues: true,
        },
        {
          moveElemsAttrsToGroup: true,
        },
        {
          moveGroupAttrsToElems: true,
        },
        {
          collapseGroups: true,
        },
        {
          removeRasterImages: false,
        },
        {
          mergePaths: true,
        },
        {
          convertShapeToPath: true,
        },
        {
          sortAttrs: true,
        },
        {
          transformsWithOnePath: false,
        },
        /*
        {
          removeAttrs: { attrs: "(stroke|fill)" },
        },
        */
      ],
    });

    const filePath = `${__dirname}/${file}`;

    const svg = fs.readFileSync(filePath, "utf8");

    const juicedSvg = juice(svg).replace(/ viewbox=/g, " viewBox=");

    const { data: optimisedSvg } = await svgo.optimize(juicedSvg, {
      path: filePath,
    });

    const optimizedFilePath = `${__dirname}/${file.replace(
      /svg$/,
      "optimized.svg"
    )}`;
    if (optimizedFilePath === filePath) {
      throw new Error("Should not overwrite!");
    }
    fs.writeFileSync(optimizedFilePath, optimisedSvg);
    /*
    run("convert", [
      //"-density",
      //"1200",
      "-size",
      "900x900",
      "-background",
      "none",
      optimizedFilePath,
      optimizedFilePath + ".png",
    ]);
    run("optipng", ["-clobber", "-o0", optimizedFilePath + ".png"]);
    */
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
