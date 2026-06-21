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
    playlistName:      str                 = "M&M Playlist"
    trackCountRange:   str                 = "15-30"
    filmIndustry:      Optional[str]       = None
    movieName:         Optional[str]       = None
    selectedMovies:    Optional[list[str]] = None
    selectedLanguages: Optional[list[str]] = None
    selectedGenres:    Optional[list[str]] = None
    # Style-quiz archetype context, sent from the frontend when the user has
    # taken the Quiz. Used by the playlist generator to bias mood + queries.
    styleArchetypeId:     Optional[str] = None
    styleArchetypeName:   Optional[str] = None
    styleVibePrompt:      Optional[str] = None
    # Songs the user pinned from the post-quiz suggestions. These spotify:track:
    # URIs are added to the generated playlist verbatim, regardless of the
    # mood/genre/language choices made in the generator menu.
    pinnedUris:           Optional[list[str]] = None
    # Genres / music types the user said they dislike — from the style-quiz
    # "a genre you can't stand" step, or carried in the quiz style seed. These
    # are STRICTLY excluded from generation (query suppression + track filter).
    # Free-text dislikes typed into moodText are parsed server-side in addition
    # to this list (see exclusions.py).
    dislikedGenres:       Optional[list[str]] = None
    # Frontend renders the playlist cover SVG → JPEG via canvas and forwards
    # the base64 payload (no "data:image/jpeg;base64," prefix). Backend
    # uploads it to Spotify via the curator account token. coverSeed is kept
    # for logging / parity with the frontend's seeded palette.
    coverImageBase64:     Optional[str] = None
    coverSeed:            Optional[int] = None


class SuggestionsRequest(BaseModel):
    """Post-quiz song suggestions (a blend of archetype + favourite-artist
    tracks, not a playlist)."""
    archetypeId:   Optional[str]       = None
    archetypeName: Optional[str]       = None
    vibePrompt:    Optional[str]       = None
    genreSeed:     Optional[list[str]] = None
    languageSeed:  Optional[list[str]] = None
    personalSeed:  Optional[str]       = None
    # Direct Spotify search queries hand-curated per archetype in
    # frontend/src/pages/quiz/quizData.js. These run BEFORE the general
    # archetype/mood/genre query builder so the result-page samples land on
    # sonic territory the archetype actually owns (e.g. "chamber music piano
    # sonata melancholy" for Dark Academia).
    searchSeeds:   Optional[list[str]] = None
    count:         int                 = 10

class MoodRequest(BaseModel):
    text: str

class VerifyEmail(BaseModel):
    email: EmailStr
    code:  str

class ResendCode(BaseModel):
    email: EmailStr

class ForgotPassword(BaseModel):
    email:  EmailStr
    method: str = "link"   # "link" (emailed reset link) or "code" (6-digit OTP)

class VerifyResetCode(BaseModel):
    email: EmailStr
    code:  str

class ResetPassword(BaseModel):
    resetToken:  str
    newPassword: str

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


class RemoveTrackRequest(BaseModel):
    """Remove a single track URI from a curator-owned playlist. Replaces the
    direct-from-frontend Spotify DELETE call (frontend no longer has a
    user-Spotify token now that auth has moved entirely to the curator account)."""
    playlist_id: str
    uri:         str