document.addEventListener("nav", () => {
  const printPage = () => window.print()

  for (const button of document.getElementsByClassName("print-to-pdf")) {
    button.addEventListener("click", printPage)
    window.addCleanup(() => button.removeEventListener("click", printPage))
  }
})
