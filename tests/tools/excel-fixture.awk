# Estrae dal foglio "Prova Bdg" (TSV: rif, valore, formula) i valori di verifica in un modulo JS
function colnum(s,   i, n) { n = 0; for (i = 1; i <= length(s); i++) n = n * 26 + index("ABCDEFGHIJKLMNOPQRSTUVWXYZ", substr(s, i, 1)); return n }
function r2(x,   s) { s = sprintf("%.2f", x + 0); sub(/\.00$/, "", s); if (s ~ /\.[0-9]0$/) s = substr(s, 1, length(s) - 1); return s }
function series(row, off,   m, out) {
  out = ""
  for (m = 1; m <= 12; m++) out = out (m > 1 ? ", " : "") r2(v[row, 6 + 3 * (m - 1) + off])
  return "[" out "]"
}
BEGIN { FS = "\t" }
{
  match($1, /^[A-Z]+/); col = substr($1, 1, RLENGTH); row = substr($1, RLENGTH + 1) + 0
  v[row, colnum(col)] = $2
  if (col == "B") b[row] = $2
}
END {
  split("Dossier Titoli FINECO|Conto corrente FINECO|Conto corrente Trade Republic|Paypal|Satispay|Revolut|Portafoglio|Cassa CSC|Crediti vs MT Prof.le|Altri crediti|Carta di credito (corrente)|Carta di credito (da addebitare)|Debiti verso CSC|Altri debiti", names, "|")
  split("116 145 165 182 200 218 238 250 263 289 307 319 331 357", sf, " ")
  print "// Valori di verifica estratti da TM27_Pers_.xlsx, foglio \"Prova Bdg\" (12 mesi, da gennaio)."
  print "// Generato una volta: non modificare a mano."
  print "export const EXCEL_2027 = {"
  print "  budget: {"
  print "    causali: {"
  for (r = 8; r <= 60; r++) if (b[r] != "") print "      " b[r] ": " series(r, 0) ","
  print "    },"
  print "    channels: {"
  for (r = 65; r <= 103; r += 2) if (b[r] != "") print "      " b[r] ": " series(r, 0) ","
  print "    },"
  print "    closing: {"
  for (i = 1; i <= 14; i++) print "      '" names[i] "': " series(sf[i], 0) ","
  print "    },"
  print "    ricavi: " series(64, 0) ","
  print "    costi: " series(86, 0) ","
  print "    posizione: " series(365, 0) ","
  print "    quadratura: " series(369, 0)
  print "  },"
  print "  // consuntivo con i due movimenti di prova di gennaio (Prova Giornale)"
  print "  actualJanuary: {"
  print "    closing: {"
  for (i = 1; i <= 14; i++) print "      '" names[i] "': " r2(v[sf[i], 7]) ","
  print "    },"
  print "    ricavi: " r2(v[64, 7]) ", costi: " r2(v[86, 7]) ", posizione: " r2(v[365, 7]) ","
  print "    channels: { RICPOR: " r2(v[65, 7]) ", COSPOR: " r2(v[87, 7]) " }"
  print "  }"
  print "};"
}
