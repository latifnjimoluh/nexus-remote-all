declare module "qrcode-terminal" {
  export function generate(
    input: string,
    options?: { small?: boolean },
    callback?: (output: string) => void,
  ): void;
  export function setErrorLevel(error: "L" | "M" | "Q" | "H"): void;
}
