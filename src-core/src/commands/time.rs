use chrono::{Local, TimeZone, Utc};
use ipgeolocate::{Locator, Service};
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn get_sunrise_sunset_time() -> Result<(String, String), String> {
    let ip = match public_ip::addr().await {
        Some(ip) => ip,
        None => return Err("IP_LOOKUP_FAILED".to_string()),
    };
    let (latitude, longitude) = match Locator::get_ipaddr(ip, Service::IpApi).await {
        Ok(data) => {
            let latitude = match (data.latitude).parse::<f64>() {
                Ok(lat) => lat,
                Err(_) => return Err("LOCATION_PARSE_FAILED".to_string()),
            };
            let longitude = match (data.longitude).parse::<f64>() {
                Ok(lon) => lon,
                Err(_) => return Err("LOCATION_PARSE_FAILED".to_string()),
            };
            (latitude, longitude)
        }
        Err(_) => return Err("LOCATION_LOOKUP_FAILED".to_string()),
    };
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(n) => n.as_millis() as i64,
        Err(_) => return Err("TIME_LOOKUP_FAILED".to_string()),
    };
    let sun_data = suncalc::get_times(suncalc::Timestamp(now), latitude, longitude, None);
    let sunrise = sun_data.sunrise.0;
    let sunset = sun_data.sunset.0;
    let sunrise_utc = Utc.timestamp_millis_opt(sunrise).unwrap();
    let sunset_utc = Utc.timestamp_millis_opt(sunset).unwrap();
    let sunrise_local = Local.from_utc_datetime(&sunrise_utc.naive_utc());
    let sunset_local = Local.from_utc_datetime(&sunset_utc.naive_utc());
    let sunrise = sunrise_local.format("%H:%M").to_string();
    let sunset = sunset_local.format("%H:%M").to_string();
    Ok((sunrise, sunset))
}
