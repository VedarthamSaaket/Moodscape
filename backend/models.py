from typing import Optional

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email:    EmailStr
    password: str

class UserLogin(BaseModel):
    email:    EmailStr
    password: str

class PlaylistRequest(BaseModel):
    moodText:          str
    playlistIntent:    Optional[str]       = None
    playlistName:      str                 = "Vaedarth AI Playlist"
    trackCountRange:   str                 = "15-30"
    filmIndustry:      Optional[str]       = None
    movieName:         Optional[str]       = None
    selectedMovies:    Optional[list[str]] = None
    selectedLanguages: Optional[list[str]] = None
    selectedGenres:    Optional[list[str]] = None

class MoodRequest(BaseModel):
    text: str

class VerifyEmail(BaseModel):
    email: EmailStr
    code:  str

class ResendCode(BaseModel):
    email: EmailStr

class AddTracksRequest(BaseModel):
    playlist_id: str
    uris:        list[str]

class SimilarTracksRequest(BaseModel):
    track_title:     str
    track_artist:    str
    playlist_id:     str
    mood_text:       Optional[str]       = None
    playlist_intent: Optional[str]       = None
    language:        Optional[str]       = None
    genre:           Optional[str]       = None
    ignored_uris:    Optional[list[str]] = None