# Сторонние библиотеки фронтенда

Лежат в репозитории, а не на CDN: проект без сборки, сторонние CDN из России
бывают недоступны, а счета не должны зависеть от чужого сервера. Грузятся
лениво — только при первом броске счетов в «Реестре оплат»
(`frontend-v2/js/registry-autofill.js`), на остальные экраны не влияют.

| Папка | Пакет npm | Версия | Лицензия | Что взято |
|---|---|---|---|---|
| `pdfjs/` | `pdfjs-dist` | 3.11.174 | Apache-2.0 | `legacy/build/pdf.min.js`, `pdf.worker.min.js` (UMD; с 4.x pdf.js только ES-модуль) |
| `jsqr/` | `jsqr` | 1.4.0 | Apache-2.0 | `dist/jsQR.js` |
| `tesseract/` | `tesseract.js` | 7.0.0 | Apache-2.0 | `dist/tesseract.min.js`, `dist/worker.min.js` |
| `tesseract/core/` | `tesseract.js-core` | 7.0.0 | Apache-2.0 | только LSTM-сборки `*-lstm.wasm.js` (обычная, SIMD, relaxed SIMD — воркер выбирает сам) |
| `tesseract/lang/` | `@tesseract.js-data/rus`, `@tesseract.js-data/eng` | 1.0.0 | MIT (данные — Apache-2.0, tesseract-ocr/tessdata) | `4.0.0_best_int/*.traineddata.gz` |

Общий размер — около 18 МБ.

Обновление: `npm i <пакет>@<версия>` во временной папке вне репозитория,
скопировать те же файлы, поправить таблицу. Модель языка выбрана по
результатам на образцах счетов — см. `openspec/changes/reestr-autofill/design.md` §1.
