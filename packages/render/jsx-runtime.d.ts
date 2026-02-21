import type { JSX as SolidJSX } from "solid-js"

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      box: any
      text: any
      span: any
      input: any
      select: any
      scrollbox: any
      tab_select: any
      ascii_font: any
      line_number: any
      b: any
      strong: any
      i: any
      em: any
      u: any
      br: any
    }
  }
}
