const path = require("path");
const fs = require("fs");

const sqlDir = path.join(process.cwd(), "./sql");
const sqlFiles = fs.readdirSync(sqlDir);

const sqlModule = sqlFiles.reduce((acc, file) => {
  const sql = fs.readFileSync(path.join(sqlDir, file), "utf8");
  const varName = "sql_" + file.replace(".sql", "").replace(/-/g, "_");
  return acc + `export const ${varName} = \`${sql}\`;\n`;
}, "");

fs.writeFileSync(path.join(process.cwd(), "./src/sql/index.ts"), sqlModule);
