export type GetStyleInfo = (resolved: { element: Element }) => {
  className: string;
  styles: Record<string, string> | null;
};

export function initDesignMode(_getStyleInfo: GetStyleInfo): () => void {
  return () => {};
}
