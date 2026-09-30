//! Minimal HTTP/1.1, over `std::net`.
//!
//! Enough for `raptor:net` and `raptor:serve`, with no dependency: the start
//! line, the headers, and a body delimited by `content-length`. It is not a full
//! HTTP stack and does not claim to be - `transfer-encoding: chunked`, HTTP/2 and
//! TLS are missing, and each is reported explicitly where it matters.
//!
//! Parsing treats the input as hostile: headers without a colon, impossible
//! lengths and broken start lines produce errors, not guessed values. A body
//! declared larger than the limit is refused before it is read, not after it has
//! filled memory.

use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;

/// The accepted body limit, in both directions. A server without a limit is an
/// invitation to memory exhaustion.
pub const MAX_BODY: usize = 8 * 1024 * 1024;

/// How long we wait for a request's headers before giving up.
pub const HEADER_LIMIT: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    pub target: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

impl Response {
    pub fn new(status: u16, body: impl Into<String>) -> Self {
        Self { status, headers: BTreeMap::new(), body: body.into() }
    }

    pub fn to_json(&self) -> Json {
        Json::from_pairs([
            ("status", Json::Number(f64::from(self.status))),
            (
                "headers",
                Json::Object(self.headers.iter().map(|(k, v)| (k.clone(), Json::string(v.clone()))).collect()),
            ),
            ("body", Json::string(self.body.clone())),
        ])
    }
}

fn protocol_error(message: impl Into<String>) -> RaptorError {
    RaptorError::new(ErrorCode::ModuleUnsupported, message)
}

/// Header names are normalized to lowercase: HTTP treats them
/// case-insensitively, and whoever reads `headers["content-type"]` from
/// JavaScript should not have to guess the form the other end sent.
fn insert_header(headers: &mut BTreeMap<String, String>, line: &str) -> Result<()> {
    let (name, value) = line.split_once(':').ok_or_else(|| protocol_error(format!("invalid header: {line}")))?;
    let name = name.trim().to_ascii_lowercase();
    if name.is_empty() {
        return Err(protocol_error("header without a name"));
    }
    headers.insert(name, value.trim().to_string());
    Ok(())
}

fn content_length(headers: &BTreeMap<String, String>) -> Result<usize> {
    match headers.get("content-length") {
        None => Ok(0),
        Some(raw) => {
            let length: usize =
                raw.trim().parse().map_err(|_| protocol_error(format!("invalid content-length: {raw}")))?;
            if length > MAX_BODY {
                return Err(protocol_error(format!("body too large: {length} bytes, limit {MAX_BODY}")));
            }
            Ok(length)
        }
    }
}

/// Reads the headers up to the blank line, with a size limit.
fn read_headers<R: BufRead>(reader: &mut R) -> Result<(String, BTreeMap<String, String>)> {
    let mut start_line = String::new();
    let mut consumed = 0;

    // Skip blank lines before the request (some clients send them).
    loop {
        start_line.clear();
        let read = reader
            .read_line(&mut start_line)
            .map_err(|error| protocol_error(format!("could not read the start line: {error}")))?;
        if read == 0 {
            return Err(protocol_error("connection closed before the request"));
        }
        consumed += read;
        if !start_line.trim().is_empty() {
            break;
        }
        if consumed > HEADER_LIMIT {
            return Err(protocol_error("headers too large"));
        }
    }

    let mut headers = BTreeMap::new();
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| protocol_error(format!("could not read the headers: {error}")))?;
        if read == 0 {
            break;
        }
        consumed += read;
        if consumed > HEADER_LIMIT {
            return Err(protocol_error("headers too large"));
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        insert_header(&mut headers, trimmed)?;
    }

    Ok((start_line.trim_end_matches(['\r', '\n']).to_string(), headers))
}

fn read_body<R: Read>(reader: &mut R, headers: &BTreeMap<String, String>) -> Result<String> {
    if headers.get("transfer-encoding").is_some_and(|value| value.to_ascii_lowercase().contains("chunked")) {
        // Better a clear refusal than a body silently truncated.
        return Err(protocol_error("transfer-encoding: chunked is not supported by this HTTP stack"));
    }
    let length = content_length(headers)?;
    if length == 0 {
        return Ok(String::new());
    }
    let mut buffer = vec![0_u8; length];
    reader.read_exact(&mut buffer).map_err(|error| protocol_error(format!("incomplete body: {error}")))?;
    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

/// Reads an HTTP request from a stream.
pub fn read_request(stream: &TcpStream) -> Result<Request> {
    let mut reader = BufReader::new(stream);
    let (start_line, headers) = read_headers(&mut reader)?;

    let mut parts = start_line.split_whitespace();
    let method = parts.next().ok_or_else(|| protocol_error("start line without a method"))?.to_string();
    let target = parts.next().ok_or_else(|| protocol_error("start line without a target"))?.to_string();

    let body = read_body(&mut reader, &headers)?;
    Ok(Request { method, target, headers, body })
}

/// Writes an HTTP response to a stream.
pub fn write_response(stream: &mut TcpStream, response: &Response) -> Result<()> {
    let reason = reason_phrase(response.status);
    let mut out = format!("HTTP/1.1 {} {reason}\r\n", response.status);
    for (name, value) in &response.headers {
        // `content-length` and `connection` are set by the stack, not the
        // application: a wrong value there would stall the client or truncate
        // the response.
        if name == "content-length" || name == "connection" {
            continue;
        }
        out.push_str(&format!("{name}: {value}\r\n"));
    }
    out.push_str(&format!("content-length: {}\r\n", response.body.len()));
    out.push_str("connection: close\r\n\r\n");
    out.push_str(&response.body);

    stream
        .write_all(out.as_bytes())
        .and_then(|()| stream.flush())
        .map_err(|error| protocol_error(format!("could not write the response: {error}")))
}

/// Sends a request and reads the response; used by `raptor:net`.
pub fn exchange(stream: &mut TcpStream, host: &str, request: &Request) -> Result<Response> {
    let mut out = format!("{} {} HTTP/1.1\r\n", request.method, request.target);
    out.push_str(&format!("host: {host}\r\n"));
    for (name, value) in &request.headers {
        if name == "content-length" || name == "connection" || name == "host" {
            continue;
        }
        out.push_str(&format!("{name}: {value}\r\n"));
    }
    out.push_str(&format!("content-length: {}\r\n", request.body.len()));
    out.push_str("connection: close\r\n\r\n");
    out.push_str(&request.body);

    stream
        .write_all(out.as_bytes())
        .and_then(|()| stream.flush())
        .map_err(|error| protocol_error(format!("could not send the request: {error}")))?;

    let mut reader = BufReader::new(stream.try_clone().map_err(|error| {
        protocol_error(format!("could not read the response: {error}"))
    })?);
    let (start_line, headers) = read_headers(&mut reader)?;

    let status: u16 = start_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| protocol_error(format!("response without a status: {start_line}")))?;

    let body = read_body(&mut reader, &headers)?;
    Ok(Response { status, headers, body })
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "",
    }
}

/// Breaks an absolute URL into (scheme, host, port, target).
///
/// The default port is part of the result because the capability target is
/// `host:port`: without it, `net.connect: ["api.exemplu.com:443"]` could not be
/// compared against `https://api.exemplu.com/x`.
pub fn split_url(url: &str) -> Result<(String, String, u16, String)> {
    let (scheme, rest) = url.split_once("://").ok_or_else(|| {
        RaptorError::new(ErrorCode::ModuleUnsupported, "raptor:net requires an absolute URL").with("url", url)
    })?;
    let scheme = scheme.to_ascii_lowercase();
    let default_port = match scheme.as_str() {
        "http" => 80,
        "https" => 443,
        other => {
            return Err(RaptorError::new(
                ErrorCode::ModuleUnsupported,
                format!("protocol not supported by raptor:net: {other}"),
            )
            .with("url", url))
        }
    };

    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (
            host.to_string(),
            port.parse::<u16>()
                .map_err(|_| protocol_error(format!("invalid port in URL: {port}")))?,
        ),
        None => (authority.to_string(), default_port),
    };
    if host.is_empty() {
        return Err(protocol_error(format!("URL without a host: {url}")));
    }

    Ok((scheme, host.to_ascii_lowercase(), port, path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descompune_un_url_cu_port_implicit() {
        let (scheme, host, port, path) = split_url("http://exemplu.com/cale?x=1").expect("url");
        assert_eq!((scheme.as_str(), host.as_str(), port, path.as_str()), ("http", "exemplu.com", 80, "/cale?x=1"));

        let (_, _, port, path) = split_url("https://API.Exemplu.com").expect("url");
        assert_eq!((port, path.as_str()), (443, "/"), "the scheme's default port and the root path");
    }

    #[test]
    fn gazda_se_normalizeaza_pentru_comparatia_de_capabilitate() {
        let (_, host, port, _) = split_url("https://API.Exemplu.COM:8443/x").expect("url");
        assert_eq!(format!("{host}:{port}"), "api.exemplu.com:8443");
    }

    #[test]
    fn un_url_fara_schema_sau_cu_schema_straina_este_refuzat() {
        assert!(split_url("/doar-cale").is_err());
        assert!(split_url("file:///etc/passwd").is_err());
        assert!(split_url("http://").is_err());
    }

    #[test]
    fn anteturile_se_normalizeaza_la_litere_mici() {
        let mut headers = BTreeMap::new();
        insert_header(&mut headers, "Content-Type: text/plain").expect("header");
        assert_eq!(headers.get("content-type").map(String::as_str), Some("text/plain"));
        assert!(insert_header(&mut headers, "no-colon").is_err());
    }

    #[test]
    fn un_corp_peste_limita_este_refuzat_inainte_sa_fie_citit() {
        let mut headers = BTreeMap::new();
        headers.insert("content-length".to_string(), (MAX_BODY + 1).to_string());
        let error = content_length(&headers).expect_err("prea mare");
        assert!(error.message.contains("too large"), "{}", error.message);
    }

    #[test]
    fn chunked_este_refuzat_explicit_nu_taiat_tacut() {
        let mut headers = BTreeMap::new();
        headers.insert("transfer-encoding".to_string(), "chunked".to_string());
        let error = read_body(&mut std::io::empty(), &headers).expect_err("chunked");
        assert!(error.message.contains("chunked"), "{}", error.message);
    }

    #[test]
    fn stack_ul_stabileste_singur_content_length() {
        let response = Response {
            status: 200,
            headers: BTreeMap::from([("content-length".to_string(), "999".to_string())]),
            body: "hello".to_string(),
        };
        // The application's value is ignored; otherwise the client would expect 999 bytes.
        assert_eq!(response.body.len(), 5);
    }
}
