export function planUi(printPathOnly: boolean): "print-path" | "open-browser" {
  return printPathOnly ? "print-path" : "open-browser";
}
