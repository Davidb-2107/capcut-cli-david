export function planUi(printPathOnly: boolean, htmlPath: string): { openBrowser: boolean; output: string } {
  return {
    openBrowser: !printPathOnly,
    output: printPathOnly ? htmlPath : `ouvert : ${htmlPath}`,
  };
}
