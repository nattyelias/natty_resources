# Class photos

Put a class's photo in this folder and describe it in `src/data/class-photos.json`.

## Rules

- **Only images I own or have written permission to use.**
- **Never CU or ATLAS logos or marks.** No university or institute branding of any kind.
- **Credit is shown on the class page.** Every photo needs a `photoCredit` line.
- Don't copy artwork from other sites or apps.

## Naming

Name each file by course code and topic, lowercase with dashes, the same as the class id:

```
atls-3040-introduction-to-games-and-play.jpg
atls-4519-generative-ai.jpg
```

Use landscape photos (the tile crops them to 4:3). Keep each file under about 300 KB.

## Describing a photo

In `src/data/class-photos.json`, add an entry keyed by the class id:

```json
{
  "atls-4519-generative-ai": {
    "photo": "class-photos/atls-4519-generative-ai.jpg",
    "photoAlt": "Students looking at a screen of generated images",
    "photoCredit": "Photo: Your Name"
  }
}
```

- `photo` is the path under `public/` (starting with `class-photos/`).
- `photoAlt` is **required** whenever `photo` is set. A photo with no alt text is ignored.
- `photoCredit` is a plain text credit line shown under the photo on the class page.

Run `npm run photos:check` to catch a missing alt, a missing file or an unknown class id.
