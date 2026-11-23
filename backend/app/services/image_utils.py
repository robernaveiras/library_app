from io import BytesIO
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

MAX_LONG_EDGE = 2048
JPEG_QUALITY = 88


def process_and_save_scan_image(raw_bytes: bytes, destination: Path) -> tuple[int, int]:
    """Normalize EXIF orientation, resize large photos cleanly, and save as JPEG.

    Returns (width, height) of the saved image in pixels.
    """
    with Image.open(BytesIO(raw_bytes)) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")

        width, height = img.size
        long_edge = max(width, height)
        if long_edge > MAX_LONG_EDGE:
            scale = MAX_LONG_EDGE / float(long_edge)
            new_size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
            width, height = img.size

        destination.parent.mkdir(parents=True, exist_ok=True)
        img.save(destination, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return width, height


def estimate_dimensions_from_bbox(
    bbox: Optional[list[float]],
    shelf_width_cm: float,
    shelf_height_cm: float,
    orientation: str = "vertical",
) -> tuple[Optional[float], Optional[float]]:
    """Estimate (width_mm, height_mm) of a book from its normalized bbox and known shelf dimensions.

    The photo generally frames the shelf width and height; we clamp results to realistic book sizes
    so noisy bounding boxes never produce impossible dimensions.
    """
    if not bbox or len(bbox) != 4:
        return None, None

    x_min, y_min, x_max, y_max = bbox
    dx = max(0.0, min(1.0, x_max) - max(0.0, x_min))
    dy = max(0.0, min(1.0, y_max) - max(0.0, y_min))
    if dx <= 0.005 or dy <= 0.05:
        return None, None

    if orientation == "horizontal":
        raw_thickness_mm = dy * shelf_height_cm * 10.0
        raw_height_mm = dx * shelf_width_cm * 10.0
    else:
        raw_thickness_mm = dx * shelf_width_cm * 10.0
        raw_height_mm = dy * shelf_height_cm * 10.0

    width_mm = round(max(8.0, min(95.0, raw_thickness_mm)), 1)
    height_mm = round(max(135.0, min(shelf_height_cm * 10.0, raw_height_mm)), 1)
    return width_mm, height_mm
