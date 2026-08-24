use super::{lock_error, CommandError};
use crate::db::{utc_now, Database};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LcscPart {
    pub lcsc_code: String,
    pub name: String,
    pub category: String,
    pub package: String,
    pub manufacturer: String,
    pub mpn: String,
}

fn normalize_code(code: &str) -> Result<String, CommandError> {
    let value = code.trim().to_ascii_uppercase();
    if value.len() < 2
        || !value.starts_with('C')
        || !value[1..].bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(CommandError::Validation(
            "LCSC ID 格式应为 C 后接数字".into(),
        ));
    }
    Ok(value)
}

fn cached(db: &Database, code: &str) -> Result<Option<LcscPart>, CommandError> {
    db.connection().query_row(
        "SELECT lcsc_code, name, category, package, manufacturer, mpn FROM lcsc_cache WHERE lcsc_code = ?1",
        [code],
        |row| Ok(LcscPart { lcsc_code: row.get(0)?, name: row.get(1)?, category: row.get(2)?, package: row.get(3)?, manufacturer: row.get(4)?, mpn: row.get(5)? }),
    ).optional().map_err(CommandError::from)
}

fn save_cache(db: &Database, part: &LcscPart) -> Result<(), CommandError> {
    db.connection().execute(
        "INSERT INTO lcsc_cache (lcsc_code, name, category, package, manufacturer, mpn, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(lcsc_code) DO UPDATE SET name = excluded.name, category = excluded.category, package = excluded.package, manufacturer = excluded.manufacturer, mpn = excluded.mpn, fetched_at = excluded.fetched_at",
        params![part.lcsc_code, part.name, part.category, part.package, part.manufacturer, part.mpn, utc_now()],
    )?;
    Ok(())
}

fn text(object: &Value, names: &[&str]) -> String {
    names
        .iter()
        .find_map(|name| object.get(*name).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn inferred_package(name: &str, description: &str) -> String {
    const PACKAGES: [&str; 8] = [
        "01005", "0201", "0402", "0603", "0805", "1206", "1210", "2512",
    ];
    let combined = format!("{name} {description}");
    PACKAGES
        .into_iter()
        .find(|package| combined.contains(package))
        .unwrap_or_default()
        .to_string()
}

fn product_from_value(code: &str, value: &Value) -> Result<LcscPart, CommandError> {
    let name = text(value, &["productName", "name", "productDescription"]);
    if name.is_empty() {
        return Err(CommandError::NotFound("未找到该 LCSC 元件".into()));
    }
    let description = text(value, &["description"]);
    let brand = value
        .get("brand")
        .map_or(String::new(), |brand| text(brand, &["name"]));
    let package = text(value, &["package", "packageName", "encapsulation"]);
    Ok(LcscPart {
        lcsc_code: normalize_code(code)?,
        name,
        category: text(value, &["catalogName", "category", "parentCatalogName"]),
        package: if package.is_empty() {
            inferred_package(&text(value, &["name", "productName"]), &description)
        } else {
            package
        },
        manufacturer: text(value, &["brandName", "manufacturer"]).or_else(|| brand),
        mpn: text(value, &["productModel", "mpn", "manufacturerPartNumber"]),
    })
}

trait OrElseString {
    fn or_else(self, fallback: impl FnOnce() -> String) -> String;
}

impl OrElseString for String {
    fn or_else(self, fallback: impl FnOnce() -> String) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn json_ld_product(code: &str, payload: &str) -> Result<LcscPart, CommandError> {
    let marker = "application/ld+json";
    let start = payload
        .find(marker)
        .ok_or_else(|| CommandError::NotFound("未找到该 LCSC 元件".into()))?;
    let json_start = payload[start..]
        .find('>')
        .map(|offset| start + offset + 1)
        .ok_or_else(|| CommandError::Database("LCSC 产品页结构异常".into()))?;
    let json_end = payload[json_start..]
        .find("</script>")
        .map(|offset| json_start + offset)
        .ok_or_else(|| CommandError::Database("LCSC 产品页结构异常".into()))?;
    let product: Value = serde_json::from_str(payload[json_start..json_end].trim())
        .map_err(|_| CommandError::Database("LCSC 产品页结构异常".into()))?;
    product_from_value(code, &product)
}

pub fn product_url_from_search(code: &str, payload: &str) -> Result<String, CommandError> {
    let suffix = format!("_{code}.html");
    let normalized = payload.replace('\\', "");
    let end = normalized
        .find(&suffix)
        .map(|offset| offset + suffix.len())
        .ok_or_else(|| CommandError::NotFound("未找到该 LCSC 元件".into()))?;
    let path_start = normalized[..end]
        .rfind("/product-detail/")
        .ok_or_else(|| CommandError::NotFound("未找到该 LCSC 元件".into()))?;
    Ok(format!(
        "https://www.lcsc.com{}",
        &normalized[path_start..end]
    ))
}

pub fn parse_lcsc_payload(code: &str, payload: &str) -> Result<LcscPart, CommandError> {
    let root: Value = match serde_json::from_str(payload) {
        Ok(root) => root,
        Err(_) => return json_ld_product(code, payload),
    };
    let value = root
        .get("result")
        .or_else(|| root.get("data"))
        .unwrap_or(&root);
    let product = value.get("product").unwrap_or(value);
    product_from_value(code, product)
}

pub fn lookup_lcsc_with_fetch<F>(
    db: &Database,
    code: &str,
    fetch: F,
) -> Result<LcscPart, CommandError>
where
    F: FnOnce(&str) -> Result<LcscPart, CommandError>,
{
    let code = normalize_code(code)?;
    match fetch(&code) {
        Ok(mut part) => {
            part.lcsc_code = code;
            save_cache(db, &part)?;
            Ok(part)
        }
        Err(error) => cached(db, &code)?.ok_or(error),
    }
}

fn fetch_online(code: &str) -> Result<LcscPart, CommandError> {
    let template = std::env::var("PARTNEST_LCSC_LOOKUP_URL").ok();
    let search_url = template
        .as_deref()
        .map(|template| template.replace("{code}", code))
        .unwrap_or_else(|| format!("https://www.lcsc.com/search?q={code}"));
    let search = ureq::get(&search_url)
        .set("Accept", "text/html,application/json")
        .set("User-Agent", "PartNest/0.1")
        .call()
        .map_err(|error| CommandError::Database(format!("LCSC 在线查询失败: {error}")))?;
    let search_body = search
        .into_string()
        .map_err(|error| CommandError::Database(format!("无法读取 LCSC 返回内容: {error}")))?;
    if template.is_some() {
        return parse_lcsc_payload(code, &search_body);
    }
    let detail_url = product_url_from_search(code, &search_body)?;
    let detail = ureq::get(&detail_url)
        .set("Accept", "text/html")
        .set("User-Agent", "PartNest/0.1")
        .call()
        .map_err(|error| CommandError::Database(format!("LCSC 产品详情查询失败: {error}")))?;
    let detail_body = detail
        .into_string()
        .map_err(|error| CommandError::Database(format!("无法读取 LCSC 产品详情: {error}")))?;
    parse_lcsc_payload(code, &detail_body)
}

#[tauri::command(rename = "lookup_lcsc")]
pub fn lookup_lcsc(
    lcsc_code: String,
    state: State<'_, Mutex<Database>>,
) -> Result<LcscPart, CommandError> {
    let db = state.lock().map_err(lock_error)?;
    lookup_lcsc_with_fetch(&db, &lcsc_code, fetch_online)
}
