document.addEventListener("nav", () => {
  const printPage = () => window.print()

  for (const button of document.getElementsByClassName("pdf-export")) {
    button.addEventListener("click", printPage)
    window.addCleanup(() => button.removeEventListener("click", printPage))
  }
})
