// @ts-ignore
import pdfExportScript from "./scripts/pdfexport.inline"
import styles from "./styles/pdfexport.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const PdfExport: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  return (
    <button
      class={classNames(displayClass, "pdf-export")}
      type="button"
      title="Export to PDF"
      aria-label="Export this page to PDF"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      <span>Export to PDF</span>
    </button>
  )
}

PdfExport.afterDOMLoaded = pdfExportScript
PdfExport.css = styles

export default (() => PdfExport) satisfies QuartzComponentConstructor
