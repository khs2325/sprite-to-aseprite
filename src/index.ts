import { mountConverterUi } from "./app/converterUi";

const appRoot = document.querySelector<HTMLElement>("#app");

if (appRoot === null) {
  throw new Error("The Sprite to Aseprite app root is missing.");
}

mountConverterUi(appRoot);
