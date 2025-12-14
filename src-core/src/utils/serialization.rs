use windows::core::GUID;

// Converts a GUID to a String
pub fn guid_to_string(guid: &GUID) -> String {
    format!(
        "{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        guid.data1,
        guid.data2,
        guid.data3,
        guid.data4[0],
        guid.data4[1],
        guid.data4[2],
        guid.data4[3],
        guid.data4[4],
        guid.data4[5],
        guid.data4[6],
        guid.data4[7]
    )
    .to_uppercase()
}

// Converts a String to a GUID
pub fn string_to_guid(guid_str: &str) -> Result<GUID, String> {
    let segments: Vec<&str> = guid_str.split('-').collect();
    if segments.len() != 5 {
        return Err("Invalid GUID format".to_string());
    }

    let data1 =
        u32::from_str_radix(segments[0], 16).map_err(|e| format!("Failed to parse Data1: {e}"))?;
    let data2 =
        u16::from_str_radix(segments[1], 16).map_err(|e| format!("Failed to parse Data2: {e}"))?;
    let data3 =
        u16::from_str_radix(segments[2], 16).map_err(|e| format!("Failed to parse Data3: {e}"))?;

    let mut data4_bytes = [0u8; 8];

    let segment3_chars: Vec<char> = segments[3].chars().collect();
    let segment4_chars: Vec<char> = segments[4].chars().collect();
    let data4_str = segment3_chars.iter().chain(segment4_chars.iter());

    for (i, byte_str) in data4_str.collect::<Vec<&char>>().chunks(2).enumerate() {
        let byte_str = byte_str.iter().map(|&&c| c).collect::<String>();
        data4_bytes[i] = u8::from_str_radix(&byte_str, 16)
            .map_err(|e| format!("Failed to parse Data4 segment {i}: {e}"))?;
    }

    Ok(GUID {
        data1,
        data2,
        data3,
        data4: data4_bytes,
    })
}
