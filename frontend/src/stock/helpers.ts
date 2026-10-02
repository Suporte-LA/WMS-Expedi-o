export function messageOf(error: unknown) {
  if (error && typeof error === "object" && "response" in error) {
    const response = error.response as { data?: { message?: string } };
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
}
export async function download(path: string, name: string) {
  const { api } = await import("../lib/api");
  const { data } = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
