// Focused entrypoint for the authoritative post-output browser capture. The
// shared harness remains combined by default for the final readability seal.
process.env.CINDERLINE_READABILITY_AUDIO_SCOPE = "audio";
await import("./readability-audio-qa.mjs");
