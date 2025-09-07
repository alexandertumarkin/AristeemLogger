from PIL import Image

# путь к исходному файлу
source_file = "logo.jpg"   # замени на своё имя файла
output_dir = "assets"

# размеры иконок, которые нужны для Chrome Extension
sizes = [16, 48, 128]

# открыть изображение
img = Image.open(source_file).convert("RGBA")

# создать папку если нет
import os
os.makedirs(output_dir, exist_ok=True)

# прогнать все размеры
for s in sizes:
    icon = img.copy()
    icon = icon.resize((s, s), Image.LANCZOS)
    out_path = os.path.join(output_dir, f"icon{s}.png")
    icon.save(out_path, format="PNG")
    print(f"Saved {out_path}")
