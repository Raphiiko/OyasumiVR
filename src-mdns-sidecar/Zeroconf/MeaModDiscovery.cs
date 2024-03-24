using MeaMod.DNS.Model;
using MeaMod.DNS.Multicast;
using Serilog;

namespace VRC.OSCQuery {
  public class MeaModDiscovery : IDiscovery {
    public static readonly string _localOscUdpServiceName = $"{OSCQueryServiceProfile.SERVICE_OSC_UDP}.local";
    public static readonly string _localOscJsonServiceName = $"{OSCQueryServiceProfile.SERVICE_OSCJSON_TCP}.local";

    public static readonly HashSet<string> MatchedNames = new HashSet<string>()
    {
      _localOscUdpServiceName, _localOscJsonServiceName
    };

    private ServiceDiscovery _discovery;
    private MulticastService _mdns;

    // Store discovered services
    private readonly HashSet<OSCQueryServiceProfile> _oscQueryServices = new HashSet<OSCQueryServiceProfile>();
    private readonly HashSet<OSCQueryServiceProfile> _oscServices = new HashSet<OSCQueryServiceProfile>();

    public HashSet<OSCQueryServiceProfile> GetOSCQueryServices() => _oscQueryServices;
    public HashSet<OSCQueryServiceProfile> GetOSCServices() => _oscServices;

    public void Dispose()
    {
      if (_discovery != null)
      {
        foreach (var profile in _profiles.Keys.ToArray())
          Unadvertise(profile);

        _discovery.Dispose();
      }

      _mdns?.Stop();
    }

    public MeaModDiscovery()
    {
      _mdns = new MulticastService();
      _mdns.UseIpv6 = false;
      _mdns.IgnoreDuplicateMessages = true;

      _discovery = new ServiceDiscovery(_mdns);

      // Query for OSC and OSCQuery services on every network interface
      _mdns.NetworkInterfaceDiscovered += (s, e) => { RefreshServices(); };

      // Callback invoked when the above query is answered
      _mdns.AnswerReceived += OnRemoteServiceInfo;
      _mdns.Start();
    }

    public void RefreshServices()
    {
      _mdns.SendQuery(_localOscUdpServiceName);
      _mdns.SendQuery(_localOscJsonServiceName);
    }

    public event Action<OSCQueryServiceProfile> OnOscServiceAdded;
    public event Action<OSCQueryServiceProfile> OnOscQueryServiceAdded;
    public event Action<string> OnOscServiceRemoved;
    public event Action<string> OnOscQueryServiceRemoved;

    private Dictionary<OSCQueryServiceProfile, ServiceProfile> _profiles =
      new Dictionary<OSCQueryServiceProfile, ServiceProfile>();

    public void Advertise(OSCQueryServiceProfile profile)
    {
      var meaProfile = new ServiceProfile(profile.name, profile.GetServiceTypeString(), (ushort)profile.port,
        new[] { profile.address });
      _discovery.Advertise(meaProfile);
      _profiles.Add(profile, meaProfile);

      Log.Information($"Advertising Service {profile.name} of type {profile.serviceType} on {profile.port}");
    }

    public void Unadvertise(OSCQueryServiceProfile profile)
    {
      if (_profiles.ContainsKey(profile))
      {
        _discovery.Unadvertise(_profiles[profile]);
        _profiles.Remove(profile);
      }

      Log.Information($"Unadvertising Service {profile.name} of type {profile.serviceType} on {profile.port}");
    }

    /// <summary>
    /// Callback invoked when an mdns Service provides information about itself
    /// </summary>
    /// <param name="sender"></param>
    /// <param name="eventArgs">Event Data with info from queried Service</param>
    private void OnRemoteServiceInfo(object sender, MessageEventArgs eventArgs)
    {
      var response = eventArgs.Message;

      try
      {
        // Check whether this service matches OSCJSON or OSC services for which we're looking
        var hasMatch = response.Answers.Any(record => MatchedNames.Contains(record?.CanonicalName));
        if (!hasMatch)
        {
          return;
        }

        if (response.Answers.Any(a => MatchedNames.Contains(a.CanonicalName)))
        {
          try
          {
            foreach (SRVRecord record in response.AdditionalRecords.OfType<SRVRecord>())
            {
              if (record.TTL == TimeSpan.Zero)
                RemoveMatchedService(record);
              else
                AddMatchedService(response, record);
            }
          }
          catch (Exception)
          {
            Log.Information($"no SRV Records found in not parse answer from {eventArgs.RemoteEndPoint}");
          }
        }
      }
      catch (Exception e)
      {
        // Using a non-error log level because we may have just found a non-matching service
        Log.Information($"Could not parse answer from {eventArgs.RemoteEndPoint}: {e.Message}");
      }
    }

    private void AddMatchedService(Message response, SRVRecord srvRecord)
    {
      // Get the rest of the items we need to track this service
      var port = srvRecord.Port;
      var domainName = srvRecord.Name.Labels;
      var instanceName = domainName[0];

      var serviceName = string.Join(".", domainName.Skip(1));
      var ips = response.AdditionalRecords.OfType<ARecord>().Select(r => r.Address);

      var ipAddressList = ips.ToList();
      var profile = new ServiceProfile(instanceName, serviceName, srvRecord.Port, ipAddressList);

      // If this is an OSC service, add it to the OSC collection
      if (string.Compare(serviceName, _localOscUdpServiceName, StringComparison.Ordinal) == 0 &&
          !_profiles.ContainsValue(profile))
      {
        // Make sure there's not already a service with the same name
        if (_oscServices.All(p => p.name != profile.InstanceName))
        {
          var p = new OSCQueryServiceProfile(instanceName, ipAddressList.First(), port,
            OSCQueryServiceProfile.ServiceType.OSC);
          _oscServices.Add(p);
          OnOscServiceAdded?.Invoke(p);
        }
      }
      // If this is an OSCQuery service, add it to the OSCQuery collection
      else if (string.Compare(serviceName, _localOscJsonServiceName, StringComparison.Ordinal) == 0 &&
               !_profiles.ContainsValue(profile))
      {
        // Make sure here's not already a service with the same name
        if (_oscQueryServices.All(p => p.name != profile.InstanceName))
        {
          var p = new OSCQueryServiceProfile(instanceName, ipAddressList.First(), port,
            OSCQueryServiceProfile.ServiceType.OSCQuery);
          _oscQueryServices.Add(p);
          OnOscQueryServiceAdded?.Invoke(p);
        }
      }
    }

    private void RemoveMatchedService(SRVRecord srvRecord)
    {
      var domainName = srvRecord.Name.Labels;
      var instanceName = domainName[0];
      var serviceName = string.Join(".", domainName.Skip(1));

      // If this is an OSC service, remove it from the OSC collection
      if (string.Compare(serviceName, _localOscUdpServiceName, StringComparison.Ordinal) == 0)
      {
        _oscServices.RemoveWhere(p => p.name == instanceName);
        OnOscServiceRemoved?.Invoke(instanceName);
      }
      // If this is an OSCQuery service, remove it from the OSCQuery collection
      else if (string.Compare(serviceName, _localOscJsonServiceName, StringComparison.Ordinal) == 0)
      {
        _oscQueryServices.RemoveWhere(p => p.name == instanceName);
        OnOscQueryServiceRemoved?.Invoke(instanceName);
      }
    }
  }
}
