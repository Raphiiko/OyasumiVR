namespace overlay_sidecar;

using System;
using System.Security.Cryptography;

public class HashUtils {
  /// <summary>
  /// Generates a short, human-readable hash of a byte array using SHA-1 and Base64 encoding.
  /// </summary>
  /// <param name="data">Byte array to hash.</param>
  /// <returns>A short, human-readable hash string.</returns>
  public static string GenerateShortHash(byte[] data)
  {
    // Validate input
    if (data == null || data.Length == 0)
    {
      throw new ArgumentException("Data cannot be null or empty.", nameof(data));
    }

    // Create SHA-1 hasher and compute hash
    using (SHA1 sha1 = new SHA1CryptoServiceProvider())
    {
      byte[] hash = sha1.ComputeHash(data);

      // Use Base64 encoding to get a human-readable string, and truncate it for brevity
      string base64Hash = Convert.ToBase64String(hash);
      return base64Hash.Substring(0, 10); // Truncated to 10 characters for shorter output
    }
  }
}
