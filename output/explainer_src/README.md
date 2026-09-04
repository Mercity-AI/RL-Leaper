# Explainer PDF source

Generates `output/pdf/Leaper_Memory_Explainer_and_Answers.pdf`, the plain-language
explainer that answers the twenty questions in
`output/pdf/Leaper_Target_Memory_and_LSTM_Runs.pdf`.

```
pip install matplotlib reportlab pillow
python output/explainer_src/make_figs.py    # draws fig/*.png
python output/explainer_src/build_pdf.py    # assembles the PDF
```

Fonts: DejaVu Sans (`/usr/share/fonts/truetype/dejavu/`). Adjust the paths at the
top of `build_pdf.py` on Windows.
