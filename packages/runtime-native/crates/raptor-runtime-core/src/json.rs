//! Minimal JSON, with no external dependencies.
//!
//! The manifest, the lockfile and every `--json` output pass through here. Two
//! properties are required by the spec, not optional:
//!
//! - **determinism** (sections 8 and 12): objects are kept in a `BTreeMap`, so
//!   serializing the same value always yields exactly the same text. Without
//!   this, `pack` cannot promise reproducible units.
//! - **fail-closed on parsing**: invalid input produces an error with a
//!   position, not a guessed value.

use std::collections::BTreeMap;
use std::fmt::Write as _;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(BTreeMap<String, Json>),
}

impl Json {
    pub fn object() -> Self {
        Json::Object(BTreeMap::new())
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(map) => map.get(key),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(text) => Some(text),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_number(&self) -> Option<f64> {
        match self {
            Json::Number(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&BTreeMap<String, Json>> {
        match self {
            Json::Object(map) => Some(map),
            _ => None,
        }
    }

    /// Construction helper: `Json::from_pairs([("a", Json::Bool(true))])`.
    pub fn from_pairs<I, K>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, Json)>,
        K: Into<String>,
    {
        Json::Object(pairs.into_iter().map(|(key, value)| (key.into(), value)).collect())
    }

    pub fn string(value: impl Into<String>) -> Self {
        Json::String(value.into())
    }

    pub fn array<I: IntoIterator<Item = Json>>(items: I) -> Self {
        Json::Array(items.into_iter().collect())
    }

    pub fn insert(&mut self, key: impl Into<String>, value: Json) {
        if let Json::Object(map) = self {
            map.insert(key.into(), value);
        }
    }
}

impl From<&str> for Json {
    fn from(value: &str) -> Self {
        Json::String(value.to_string())
    }
}

impl From<String> for Json {
    fn from(value: String) -> Self {
        Json::String(value)
    }
}

impl From<bool> for Json {
    fn from(value: bool) -> Self {
        Json::Bool(value)
    }
}

impl From<u64> for Json {
    fn from(value: u64) -> Self {
        Json::Number(value as f64)
    }
}

impl From<usize> for Json {
    fn from(value: usize) -> Self {
        Json::Number(value as f64)
    }
}

// --- serialization -----------------------------------------------------------

fn write_escaped(out: &mut String, text: &str) {
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            control if (control as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", control as u32);
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

fn write_number(out: &mut String, value: f64) {
    if !value.is_finite() {
        // JSON has no NaN/Infinity; `null` is the only valid representation.
        out.push_str("null");
    } else if value == value.trunc() && value.abs() < 1e15 {
        let _ = write!(out, "{}", value as i64);
    } else {
        let _ = write!(out, "{value}");
    }
}

fn write_value(out: &mut String, value: &Json, indent: Option<usize>, depth: usize) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(true) => out.push_str("true"),
        Json::Bool(false) => out.push_str("false"),
        Json::Number(number) => write_number(out, *number),
        Json::String(text) => write_escaped(out, text),
        Json::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_break(out, indent, depth + 1);
                write_value(out, item, indent, depth + 1);
            }
            write_break(out, indent, depth);
            out.push(']');
        }
        Json::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (index, (key, item)) in map.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_break(out, indent, depth + 1);
                write_escaped(out, key);
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_value(out, item, indent, depth + 1);
            }
            write_break(out, indent, depth);
            out.push('}');
        }
    }
}

fn write_break(out: &mut String, indent: Option<usize>, depth: usize) {
    if let Some(width) = indent {
        out.push('\n');
        for _ in 0..(width * depth) {
            out.push(' ');
        }
    }
}

/// Compact, deterministic serialization.
pub fn to_string(value: &Json) -> String {
    let mut out = String::new();
    write_value(&mut out, value, None, 0);
    out
}

/// Indented, deterministic serialization - the form written to files.
pub fn to_string_pretty(value: &Json) -> String {
    let mut out = String::new();
    write_value(&mut out, value, Some(2), 0);
    out
}

// --- parsing ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub offset: usize,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{} (position {})", self.message, self.offset)
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    source: &'a str,
    position: usize,
    depth: usize,
}

/// Depth limit: hostile input must not be able to exhaust the stack.
const MAX_DEPTH: usize = 128;

impl<'a> Parser<'a> {
    fn error(&self, message: impl Into<String>) -> ParseError {
        ParseError { message: message.into(), offset: self.position }
    }

    fn skip_whitespace(&mut self) {
        while let Some(byte) = self.bytes.get(self.position) {
            if matches!(byte, b' ' | b'\t' | b'\n' | b'\r') {
                self.position += 1;
            } else {
                break;
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    fn expect(&mut self, byte: u8) -> Result<(), ParseError> {
        if self.peek() == Some(byte) {
            self.position += 1;
            Ok(())
        } else {
            Err(self.error(format!("expected '{}'", byte as char)))
        }
    }

    fn literal(&mut self, word: &str, value: Json) -> Result<Json, ParseError> {
        if self.source[self.position..].starts_with(word) {
            self.position += word.len();
            Ok(value)
        } else {
            Err(self.error("unknown value"))
        }
    }

    fn parse_value(&mut self) -> Result<Json, ParseError> {
        if self.depth > MAX_DEPTH {
            return Err(self.error("structure too deep"));
        }
        self.skip_whitespace();
        match self.peek().ok_or_else(|| self.error("incomplete input"))? {
            b'{' => self.parse_object(),
            b'[' => self.parse_array(),
            b'"' => Ok(Json::String(self.parse_string()?)),
            b't' => self.literal("true", Json::Bool(true)),
            b'f' => self.literal("false", Json::Bool(false)),
            b'n' => self.literal("null", Json::Null),
            _ => self.parse_number(),
        }
    }

    fn parse_object(&mut self) -> Result<Json, ParseError> {
        self.expect(b'{')?;
        self.depth += 1;
        let mut map = BTreeMap::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.position += 1;
            self.depth -= 1;
            return Ok(Json::Object(map));
        }
        loop {
            self.skip_whitespace();
            let key = self.parse_string()?;
            self.skip_whitespace();
            self.expect(b':')?;
            let value = self.parse_value()?;
            map.insert(key, value);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.position += 1,
                Some(b'}') => {
                    self.position += 1;
                    self.depth -= 1;
                    return Ok(Json::Object(map));
                }
                _ => return Err(self.error("expected ',' or '}'")),
            }
        }
    }

    fn parse_array(&mut self) -> Result<Json, ParseError> {
        self.expect(b'[')?;
        self.depth += 1;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.position += 1;
            self.depth -= 1;
            return Ok(Json::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.position += 1,
                Some(b']') => {
                    self.position += 1;
                    self.depth -= 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(self.error("expected ',' or ']'")),
            }
        }
    }

    fn parse_string(&mut self) -> Result<String, ParseError> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let byte = self.peek().ok_or_else(|| self.error("unterminated string"))?;
            match byte {
                b'"' => {
                    self.position += 1;
                    return Ok(out);
                }
                b'\\' => {
                    self.position += 1;
                    let escape = self.peek().ok_or_else(|| self.error("unterminated escape"))?;
                    self.position += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{08}'),
                        b'f' => out.push('\u{0c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => out.push(self.parse_unicode_escape()?),
                        _ => return Err(self.error("unrecognized escape")),
                    }
                }
                control if control < 0x20 => return Err(self.error("control character in a string")),
                _ => {
                    // We advance by characters, not bytes, so UTF-8 stays valid.
                    let rest = &self.source[self.position..];
                    let character = rest.chars().next().ok_or_else(|| self.error("invalid string"))?;
                    out.push(character);
                    self.position += character.len_utf8();
                }
            }
        }
    }

    fn parse_hex4(&mut self) -> Result<u32, ParseError> {
        let slice = self
            .source
            .get(self.position..self.position + 4)
            .ok_or_else(|| self.error("incomplete \\u escape"))?;
        let value = u32::from_str_radix(slice, 16).map_err(|_| self.error("invalid \\u escape"))?;
        self.position += 4;
        Ok(value)
    }

    fn parse_unicode_escape(&mut self) -> Result<char, ParseError> {
        let first = self.parse_hex4()?;
        // Surrogate pairs combine; a lone surrogate is an error, not a silent
        // replacement character.
        if (0xD800..0xDC00).contains(&first) {
            if !self.source[self.position..].starts_with("\\u") {
                return Err(self.error("high surrogate without a pair"));
            }
            self.position += 2;
            let second = self.parse_hex4()?;
            if !(0xDC00..0xE000).contains(&second) {
                return Err(self.error("invalid low surrogate"));
            }
            let combined = 0x1_0000 + ((first - 0xD800) << 10) + (second - 0xDC00);
            return char::from_u32(combined).ok_or_else(|| self.error("invalid surrogate pair"));
        }
        if (0xDC00..0xE000).contains(&first) {
            return Err(self.error("low surrogate without a high surrogate"));
        }
        char::from_u32(first).ok_or_else(|| self.error("invalid code point"))
    }

    fn parse_number(&mut self) -> Result<Json, ParseError> {
        let start = self.position;
        if self.peek() == Some(b'-') {
            self.position += 1;
        }
        while let Some(byte) = self.peek() {
            if byte.is_ascii_digit() || matches!(byte, b'.' | b'e' | b'E' | b'+' | b'-') {
                self.position += 1;
            } else {
                break;
            }
        }
        let text = &self.source[start..self.position];
        text.parse::<f64>()
            .map(Json::Number)
            .map_err(|_| ParseError { message: format!("invalid number: '{text}'"), offset: start })
    }
}

pub fn parse(source: &str) -> Result<Json, ParseError> {
    let mut parser = Parser { bytes: source.as_bytes(), source, position: 0, depth: 0 };
    let value = parser.parse_value()?;
    parser.skip_whitespace();
    if parser.position != source.len() {
        return Err(parser.error("extra content after the JSON value"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsarea_acopera_toate_tipurile() {
        let value = parse(r#"{"a":1,"b":[true,false,null],"c":"text","d":-2.5e2}"#).expect("valid JSON");
        assert_eq!(value.get("a").and_then(Json::as_number), Some(1.0));
        assert_eq!(value.get("c").and_then(Json::as_str), Some("text"));
        assert_eq!(value.get("d").and_then(Json::as_number), Some(-250.0));
        assert_eq!(value.get("b").and_then(Json::as_array).map(<[Json]>::len), Some(3));
    }

    #[test]
    fn serializarea_este_determinista_indiferent_de_ordinea_inserarii() {
        let mut first = Json::object();
        first.insert("z", Json::from(1u64));
        first.insert("a", Json::from(2u64));

        let mut second = Json::object();
        second.insert("a", Json::from(2u64));
        second.insert("z", Json::from(1u64));

        assert_eq!(to_string(&first), to_string(&second));
        assert_eq!(to_string(&first), r#"{"a":2,"z":1}"#);
    }

    #[test]
    fn dus_intors_pastreaza_valoarea() {
        let source = r#"{"lista":[1,2,3],"imbricat":{"x":true},"gol":{},"vid":[]}"#;
        let parsed = parse(source).expect("valid JSON");
        assert_eq!(parse(&to_string(&parsed)).expect("reparse"), parsed);
        assert_eq!(parse(&to_string_pretty(&parsed)).expect("reparse"), parsed);
    }

    #[test]
    fn escape_urile_sunt_scrise_si_citite_simetric() {
        let original = Json::string("new\nline \"quotes\" \\backslash\t\u{1}");
        let text = to_string(&original);
        assert!(text.contains("\\u0001"), "the control is escaped: {text}");
        assert_eq!(parse(&text).expect("reparse"), original);
    }

    #[test]
    fn perechile_surogat_devin_un_singur_caracter() {
        let value = parse(r#""\ud83e\udd80""#).expect("valid surrogate");
        assert_eq!(value.as_str(), Some("\u{1F980}"));
    }

    #[test]
    fn intrarea_invalida_esueaza_cu_pozitie_in_loc_sa_ghiceasca() {
        for bad in [
            "{",
            "{\"a\"}",
            "{\"a\":}",
            "[1,]",
            "\"unterminated",
            "tru",
            "{\"a\":1} extra",
            r#""\ud800""#,
            "{\"a\":1,}",
        ] {
            let error = parse(bad).expect_err(&format!("'{bad}' should have been rejected"));
            assert!(!error.message.is_empty());
        }
    }

    #[test]
    fn adancimea_excesiva_este_respinsa_in_loc_sa_epuizeze_stiva() {
        let deep = format!("{}{}", "[".repeat(512), "]".repeat(512));
        assert!(parse(&deep).is_err());
    }

    #[test]
    fn numerele_intregi_nu_capata_coada_zecimala() {
        assert_eq!(to_string(&Json::Number(42.0)), "42");
        assert_eq!(to_string(&Json::Number(-7.0)), "-7");
        assert_eq!(to_string(&Json::Number(0.5)), "0.5");
    }
}
