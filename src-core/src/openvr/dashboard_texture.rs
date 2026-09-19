use std::time::{Duration, Instant};
use windows::{
    core::{BOOL, HRESULT},
    Win32::{
        Foundation::HMODULE,
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
            Direct3D11::*,
            Dxgi::{Common::*, CreateDXGIFactory1, IDXGIFactory1},
        },
    },
};

pub struct DashboardTexture {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    texture: ID3D11Texture2D,
    uploaded: ID3D11Query,
}

impl DashboardTexture {
    pub unsafe fn new(adapter_index: i32, width: u32, height: u32) -> windows::core::Result<Self> {
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let adapter = factory.EnumAdapters1(adapter_index as u32)?;
        let mut device = None;
        let mut context = None;
        D3D11CreateDevice(
            &adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
        let device = device.unwrap();
        let context = context.unwrap();
        let mut texture = None;
        device.CreateTexture2D(
            &D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
                MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
                ..Default::default()
            },
            None,
            Some(&mut texture),
        )?;
        let mut uploaded = None;
        device.CreateQuery(
            &D3D11_QUERY_DESC {
                Query: D3D11_QUERY_EVENT,
                MiscFlags: 0,
            },
            Some(&mut uploaded),
        )?;
        Ok(Self {
            device,
            context,
            texture: texture.unwrap(),
            uploaded: uploaded.unwrap(),
        })
    }

    pub unsafe fn upload(&self, rgba: &[u8], width: u32) -> windows::core::Result<()> {
        let mut pixels = rgba.to_vec();
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
        self.device.GetDeviceRemovedReason()?;
        self.context.UpdateSubresource(
            &self.texture,
            0,
            None,
            pixels.as_ptr().cast(),
            width * 4,
            0,
        );
        self.finish()
    }

    pub fn device(&self) -> &ID3D11Device {
        &self.device
    }

    pub unsafe fn copy(&self, source: &ID3D11Texture2D) -> windows::core::Result<()> {
        let mut expected = D3D11_TEXTURE2D_DESC::default();
        let mut actual = D3D11_TEXTURE2D_DESC::default();
        self.texture.GetDesc(&mut expected);
        source.GetDesc(&mut actual);
        if actual.Width != expected.Width
            || actual.Height != expected.Height
            || actual.Format != expected.Format
        {
            return Err(HRESULT::from_win32(87).into());
        }
        self.context.CopyResource(&self.texture, source);
        self.finish()
    }

    unsafe fn finish(&self) -> windows::core::Result<()> {
        self.context.End(&self.uploaded);
        self.context.Flush();
        let started = Instant::now();
        loop {
            let mut ready = BOOL(0);
            self.context.GetData(
                &self.uploaded,
                Some((&mut ready as *mut BOOL).cast()),
                std::mem::size_of::<BOOL>() as u32,
                0,
            )?;
            if ready.as_bool() {
                break;
            }
            self.device.GetDeviceRemovedReason()?;
            if started.elapsed() > Duration::from_millis(250) {
                return Err(HRESULT::from_win32(1460).into());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        Ok(())
    }

    pub fn texture(&self) -> &ID3D11Texture2D {
        &self.texture
    }
}
