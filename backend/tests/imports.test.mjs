import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { parseKpiFile, parseOrderCatalogFile } from "../dist/src/services/importParser.js";

test("CSV import preserves KPI dates and numeric values", () => {
  const result = parseKpiFile({filename:"kpi.csv", fileBuffer:Buffer.from("Usuario,Data,Pedidos,Volume,Peso\nAna,2026-09-28,2,3,4.5")});
  assert.equal(result.rejectionReasons.length,0);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].orders_count,2);
  assert.equal(result.rows[0].weight_kg,4.5);
});
test("updated XLSX library roundtrips KPI spreadsheets", () => {
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{Usuario:"Ana",Data:"2026-09-28",Pedidos:2,Volume:3,Peso:4.5}]),"Externos");
  const fileBuffer=XLSX.write(workbook,{type:"buffer",bookType:"xlsx"});
  const result=parseKpiFile({filename:"kpi.xlsx",fileBuffer});
  assert.equal(result.rejectionReasons.length,0);
  assert.equal(result.rows[0].user_name,"Ana");
  assert.equal(result.rows[0].boxes_count,3);
});
test("order catalog CSV import still deduplicates orders",()=>{
  const rows=parseOrderCatalogFile({filename:"base.csv",fileBuffer:Buffer.from("Pedido,Lote,Volume,Peso\n123,A,2,3\n123,A,2,3")});
  assert.equal(rows.length,1);
  assert.equal(rows[0].order_number,"123");
});
