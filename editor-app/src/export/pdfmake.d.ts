// pdfmake 无官方类型声明，这里提供导出模块所需的最小子集
declare module 'pdfmake/build/pdfmake' {
  export interface PdfMakeFontContainer {
    vfs: Record<string, string>
    fonts: Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', string>>
  }
  export interface PdfMakeOutputDocument {
    getBlob(): Promise<Blob>
  }
  const pdfMake: {
    virtualfs?: { existsSync?: (f: string) => boolean }
    addFontContainer(c: PdfMakeFontContainer): void
    createPdf(doc: unknown): PdfMakeOutputDocument
  }
  export default pdfMake
}
