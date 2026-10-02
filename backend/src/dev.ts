process.env.NODE_ENV = "development";
process.env.STOCK_ENABLED ??= "true";
await import("./server.js");
export {};
