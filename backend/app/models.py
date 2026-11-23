from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Bookcase(Base):
    __tablename__ = "bookcases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    shelves: Mapped[list["Shelf"]] = relationship(
        "Shelf",
        back_populates="bookcase",
        cascade="all, delete-orphan",
        order_by="Shelf.position_index",
    )


class Shelf(Base):
    __tablename__ = "shelves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    bookcase_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("bookcases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    position_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width_cm: Mapped[float] = mapped_column(Float, nullable=False)
    height_cm: Mapped[float] = mapped_column(Float, nullable=False)
    depth_cm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    bookcase: Mapped["Bookcase"] = relationship("Bookcase", back_populates="shelves")
    scans: Mapped[list["ShelfScan"]] = relationship(
        "ShelfScan", back_populates="shelf", cascade="all, delete-orphan"
    )
    placements: Mapped[list["BookPlacement"]] = relationship(
        "BookPlacement",
        back_populates="shelf",
        cascade="all, delete-orphan",
        order_by="BookPlacement.position_index",
    )


class ShelfScan(Base):
    __tablename__ = "shelf_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    shelf_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("shelves.id", ondelete="CASCADE"), nullable=False, index=True
    )
    image_path: Mapped[str] = mapped_column(String(500), nullable=False)
    ai_provider: Mapped[str] = mapped_column(String(50), nullable=False)
    ai_model: Mapped[str] = mapped_column(String(120), nullable=False)
    raw_response_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    shelf: Mapped["Shelf"] = relationship("Shelf", back_populates="scans")


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    subtitle: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    authors_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    publisher: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    published_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    language: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    isbn_10: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    isbn_13: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Physical dimensions in millimeters (spine thickness & height)
    width_mm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    height_mm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dimensions_source: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    cover_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    synopsis: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Normalized taxonomy & series
    genre: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    subgenre: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    series_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    series_index: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Reading state (supports "pendientes de leer" organization criterion)
    reading_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")

    # Extensible AI/user attributes (e.g. author_gender, country, era)
    extra_attributes_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    placement: Mapped[Optional["BookPlacement"]] = relationship(
        "BookPlacement", back_populates="book", uselist=False, cascade="all, delete-orphan"
    )
    book_tags: Mapped[list["BookTag"]] = relationship(
        "BookTag", back_populates="book", cascade="all, delete-orphan"
    )


class BookPlacement(Base):
    __tablename__ = "book_placements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    book_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    shelf_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("shelves.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Open for future special shelf arrangements
    orientation: Mapped[str] = mapped_column(String(20), nullable=False, default="vertical")
    row_depth: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bbox_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scan_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("shelf_scans.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    book: Mapped["Book"] = relationship("Book", back_populates="placement")
    shelf: Mapped["Shelf"] = relationship("Shelf", back_populates="placements")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color_hex: Mapped[str] = mapped_column(String(16), nullable=False, default="#92400e")
    ai_rule_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    book_tags: Mapped[list["BookTag"]] = relationship(
        "BookTag", back_populates="tag", cascade="all, delete-orphan"
    )


class BookTag(Base):
    __tablename__ = "book_tags"
    __table_args__ = (UniqueConstraint("book_id", "tag_id", name="uq_book_tag"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    book_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tag_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    book: Mapped["Book"] = relationship("Book", back_populates="book_tags")
    tag: Mapped["Tag"] = relationship("Tag", back_populates="book_tags")


class OrganizationPlan(Base):
    __tablename__ = "organization_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    criteria_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    target_placements_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    move_steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    warnings_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
