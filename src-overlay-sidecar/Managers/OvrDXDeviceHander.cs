using Serilog;
using SharpDX;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Valve.VR;
using Device = SharpDX.Direct3D11.Device;
using Device1 = SharpDX.Direct3D11.Device1;
using Device2 = SharpDX.Direct3D11.Device2;
using Device3 = SharpDX.Direct3D11.Device3;
using Device4 = SharpDX.Direct3D11.Device4;

namespace overlay_sidecar;

public abstract class OvrDXDeviceHander
{
  protected Device? Device;
  public Device D3D11Device => Device!;

  public abstract void Initialize();

  public abstract void Uninitialize();
}

public class NonAcceleratedOvrDXDeviceHander : OvrDXDeviceHander
{
  public NonAcceleratedOvrDXDeviceHander()
  {
  }

  public override void Initialize()
  {
    try
    {
      Factory f = new Factory1();
      Device = new Device(f.GetAdapter(OpenVR.System.GetD3D9AdapterIndex()),
        DeviceCreationFlags.SingleThreaded | DeviceCreationFlags.BgraSupport);
    }
    catch (SharpDXException err)
    {
      Log.Error("Could not initialize D3D device" + err);
      throw;
    }
  }

  public override void Uninitialize()
  {
    Device?.Dispose();
    Device = null;
  }
}

public class AcceleratedOvrDXDeviceHander : OvrDXDeviceHander
{
  public override void Initialize()
  {
    try
    {
      var factory = new Factory1();
      Device?.Dispose();
      Device = new Device(factory.GetAdapter(OpenVR.System.GetD3D9AdapterIndex()),
        DeviceCreationFlags.BgraSupport);
      UpgradeDevice();
    }
    catch (SharpDXException err)
    {
      Log.Error("Could not initialize D3D device" + err);
      throw;
    }
  }

  public override void Uninitialize()
  {
    Device?.Dispose();
    Device = null;
  }

  private void UpgradeDevice()
  {
    var device5 = Device.QueryInterfaceOrNull<Device5>();
    if (device5 != null)
    {
      Device.Dispose();
      Device = device5;
      return;
    }

    var device4 = Device.QueryInterfaceOrNull<Device4>();
    if (device4 != null)
    {
      Device.Dispose();
      Device = device4;
      return;
    }

    var device3 = Device.QueryInterfaceOrNull<Device3>();
    if (device3 != null)
    {
      Device.Dispose();
      Device = device3;
      return;
    }

    var device2 = Device.QueryInterfaceOrNull<Device2>();
    if (device2 != null)
    {
      Device.Dispose();
      Device = device2;
      return;
    }

    var device1 = Device.QueryInterfaceOrNull<Device1>();
    if (device1 != null)
    {
      Device.Dispose();
      Device = device1;
    }
  }
}
