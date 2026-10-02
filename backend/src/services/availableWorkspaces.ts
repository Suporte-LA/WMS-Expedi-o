// Explicit deployment flag; changing NODE_ENV never enables a business module.
export const stockEnabled = process.env.STOCK_ENABLED === "true";
export const stockReadOnly = process.env.STOCK_READ_ONLY === "true";
export const availableWorkspaces: ["expedicao", ...("estoque")[]] = stockEnabled ? ["expedicao", "estoque"] : ["expedicao"];
