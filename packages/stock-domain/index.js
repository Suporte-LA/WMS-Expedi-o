export function normalizarEan(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits.length === 12 ? `0${digits}` : digits;
}
export function validarEan(value) {
  const code = normalizarEan(value);
  if (![8, 13, 14].includes(code.length)) return false;
  const sum = code.slice(0, -1).split("").reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(code.at(-1));
}
