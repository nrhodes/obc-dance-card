# User manual

`OBC-Dance-Card-Manual.pdf` is the manual for members, partner stewards and administrators.

To regenerate it after editing the text in `src/content.mjs` (needs `pdftotext` on the PATH):

```sh
node docs/manual/src/build.mjs
```

The screenshots in `src/shots/` were captured from the emulator (`npm run emulators`, `npm run seed`,
`npm run dev -w web`) with seeded demo members; they contain no real member data.
