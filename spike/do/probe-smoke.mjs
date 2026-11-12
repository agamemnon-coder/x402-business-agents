import { workerd } from "./mf.mjs";
import { fileURLToPath } from "node:url";
const mf = workerd({ modules: [{ type: "ESModule", path: fileURLToPath(new URL("./probeWorker.js", import.meta.url)) }], binding: "PROBE", className: "Probe" });
const send = async (ops, tx = false, n = "a") => (await mf.dispatchFetch(`http://probe/?n=${n}`, { method: "POST", body: JSON.stringify({ ops, tx }) })).json();
try {
  const r = await send([
    { sql: "SELECT sqlite_version() AS v" },
    { sql: "SELECT typeof(?) AS t_int, typeof(?) AS t_real, typeof(?) AS t_text, typeof(?) AS t_null, ? AS echo, ? || '' AS as_text", args: [5, 5.5, "x", null, 5, 5] },
    { sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, n INTEGER, x)" },
    { sql: "INSERT INTO t (a, n, x) VALUES (?, ?, ?)", args: [7, 7, 7] },
    { sql: "SELECT changes() AS c, last_insert_rowid() AS r, total_changes() AS tc" },
    { sql: "SELECT id, a, typeof(a) AS ta, n, typeof(n) AS tn, x, typeof(x) AS tx FROM t" },
    { sql: "SELECT ?1 AS a, ?2 AS b, ?1 AS c", args: ["one", "two"] },
    { sql: "SELECT :x AS a", args: ["named"] },
    { sql: "SELECT @x AS a, @y AS b", args: ["n1", "n2"] },
    { sql: "SELECT 1 AS a; SELECT 2 AS b" },
    { sql: "SELECT ? AS u", args: [{ $undefined: 1 }] },
    { sql: "SELECT ? AS b", args: [true] },
    { sql: "SELECT ? AS blob, typeof(?) AS tb", args: [{ $blob: [1, 2, 3] }, { $blob: [1] }] },
    { sql: "SELECT 9007199254740993 AS big, 1 AS one" },
    { sql: "SELECT json_extract('{\"a\":{\"b\":3}}', '$.a.b') AS j, json_object('k', ?) AS o", args: [5] },
  ]);
  for (const x of r) console.log(JSON.stringify(x));
} finally { await mf.dispose(); }
