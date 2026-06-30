# Browser-local privacy

Browser-local processing means the converter reads files you select or drop
with browser APIs such as `File`, `Blob`, image decoding, canvas, and object
URLs. Conversion work runs in the browser tab, and source artwork is not
uploaded to a project server or sent to a remote image-processing service for
conversion.

Downloads are generated locally from the converted bytes in the browser. The
`.aseprite` file is offered as a browser download; the project does not upload
that generated file after export.

Browser-local processing does not make files private after you voluntarily
share them somewhere else. Attaching artwork to GitHub issues, support
requests, cloud drives, chat tools, external validators, payment provider
pages, or other services is a separate action governed by those services. Do
not share private artwork when reporting a problem; use a newly created minimal
test file when possible.

