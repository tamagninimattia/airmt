# Converte le liste VALUES di seed_default_chart (schema) e di seed_2027.sql in array JS.
# Uso: awk -f chart.awk contabilita_schema.sql seed_2027.sql
function emit(name) { if (cur != name) { if (cur != "") print "];"; print "export const " name " = ["; cur = name } }
function row(line) {
  sub(/^[ \t]*\(/, "  [", line); sub(/\),?[ \t]*$/, "],", line)
  gsub(/array\[/, "[", line); gsub(/\]::numeric\[\]/, "]", line)
  print line
}
BEGIN { print "// Generato da contabilita_schema.sql (seed_default_chart) e seed_2027.sql: non modificare a mano."; cur = "" }
FNR == 1 { file++ }
file == 1 && /-- 5\.1/ { sec = "PATRIMONIALI" }
file == 1 && /-- 5\.2/ { sec = "CAUSALI_FINANZIARIE" }
file == 1 && /-- 5\.3/ { sec = "PER_CANALE_TIPI" }
file == 1 && /as p\(prefix/ { sec = "PER_CANALE_CANALI" }
file == 1 && /-- 5\.4/ { sec = "CAUSALI_RICAVO_COSTO" }
file == 1 && /-- 5\.5/ { sec = "ECONOMICI" }
file == 1 && /return 'Piano dei conti e causali caricati'/ { sec = "" }
file == 2 && /saldi iniziali al 1\/1\/2027/ { sec = "SALDI_INIZIALI" }
file == 2 && /budget per causale finanziaria/ { sec = "BUDGET_CAUSALI" }
file == 2 && /budget per conto economico/ { sec = "BUDGET_CONTI" }
file == 2 && /^end \$\$;/ { sec = "" }
# target di risparmio dell'anno (riga "update years set target = ..." di seed_2027.sql)
file == 2 && /update years set target = / {
  if (cur != "") { print "];"; cur = "" }
  match($0, /target = [0-9.]+/)
  print "export const TARGET = " substr($0, RSTART + 9, RLENGTH - 9) ";"
}
sec != "" && /^[ \t]*\('/ { emit(sec); row($0) }
END { if (cur != "") print "];" }
