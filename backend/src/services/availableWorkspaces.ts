// Fail closed: stock is available only through the explicit development command.
export const stockEnabled = process.env.NODE_ENV === "development";
export const availableWorkspaces: ["expedicao", ...("estoque")[]] = stockEnabled ? ["expedicao", "estoque"] : ["expedicao"];
