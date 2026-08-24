use partnest_desktop_lib::{
    commands::{
        lcsc::{lookup_lcsc_with_fetch, parse_lcsc_payload, LcscPart},
        CommandError,
    },
    db::{new_id, Database},
};
use rusqlite::params;

fn test_database() -> Database {
    let path = std::env::temp_dir().join(format!(
        "partnest-lcsc-{}-{}.db",
        std::process::id(),
        new_id()
    ));
    Database::open(path).unwrap()
}

fn sample() -> LcscPart {
    LcscPart {
        lcsc_code: "C25804".into(),
        name: "100kΩ 电阻".into(),
        category: "电阻".into(),
        package: "0402".into(),
        manufacturer: "UNI-ROYAL".into(),
        mpn: "0402WGF1003TEE".into(),
    }
}

#[test]
fn online_lookup_refreshes_the_local_cache() {
    let db = test_database();
    let value = lookup_lcsc_with_fetch(&db, " c25804 ", |_| Ok(sample())).unwrap();
    assert_eq!(value.lcsc_code, "C25804");
    let stored: String = db
        .connection()
        .query_row(
            "SELECT name FROM lcsc_cache WHERE lcsc_code = 'C25804'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "100kΩ 电阻");
}

#[test]
fn failed_online_lookup_returns_the_cached_record() {
    let db = test_database();
    db.connection().execute("INSERT INTO lcsc_cache (lcsc_code, name, category, package, manufacturer, mpn, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params!["C25804", "100kΩ 电阻", "电阻", "0402", "UNI-ROYAL", "0402WGF1003TEE", "now"]).unwrap();
    let value = lookup_lcsc_with_fetch(&db, "C25804", |_| {
        Err(CommandError::Database("network unavailable".into()))
    })
    .unwrap();
    assert_eq!(value.mpn, "0402WGF1003TEE");
}

#[test]
fn parses_common_public_product_payload_fields() {
    let value = parse_lcsc_payload("C25804", r#"{"result":{"productName":"100kΩ 电阻","catalogName":"电阻","package":"0402","brandName":"UNI-ROYAL","productModel":"0402WGF1003TEE"}}"#).unwrap();
    assert_eq!(value, sample());
}

#[test]
fn parses_product_json_ld_embedded_in_the_public_detail_page() {
    let value = parse_lcsc_payload(
        "C25804",
        r#"<!doctype html><html><head><script type="application/ld+json">{
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "UNI-ROYAL 0603WAF1002T5E",
          "sku": "C25804",
          "mpn": "0603WAF1002T5E",
          "brand": { "@type": "Brand", "name": "UNI-ROYAL" },
          "description": "10kΩ ±1% 100mW 0603 Thick Film Resistor",
          "category": "Resistors/Chip Resistor - Surface Mount"
        }</script></head></html>"#,
    )
    .unwrap();

    assert_eq!(value.lcsc_code, "C25804");
    assert_eq!(value.name, "UNI-ROYAL 0603WAF1002T5E");
    assert_eq!(value.category, "Resistors/Chip Resistor - Surface Mount");
    assert_eq!(value.manufacturer, "UNI-ROYAL");
    assert_eq!(value.mpn, "0603WAF1002T5E");
    assert_eq!(value.package, "0603");
}

#[test]
fn finds_the_public_detail_url_from_search_results() {
    let url = partnest_desktop_lib::commands::lcsc::product_url_from_search(
        "C25804",
        r#"<a href="/product-detail/Chip-Resistor-Surface-Mount_UNI-ROYAL-UniOhm-0402WGF1003TEE_C25804.html">item</a>"#,
    )
    .unwrap();

    assert_eq!(url, "https://www.lcsc.com/product-detail/Chip-Resistor-Surface-Mount_UNI-ROYAL-UniOhm-0402WGF1003TEE_C25804.html");
}

#[test]
fn finds_the_public_detail_url_when_next_data_escapes_slashes() {
    let url = partnest_desktop_lib::commands::lcsc::product_url_from_search(
        "C25804",
        r#"{\"href\":\"\\/product-detail\\/Chip-Resistor_C25804.html\"}"#,
    )
    .unwrap();

    assert_eq!(
        url,
        "https://www.lcsc.com/product-detail/Chip-Resistor_C25804.html"
    );
}
