use super::{steamvr::SteamVr, NativeUi};
use ash::{
    vk::{self, Handle},
    Device, Entry, Instance,
};
use dear_imgui_ash::{AshRenderer, AshRendererConfig};
use dear_imgui_rs::Ui;
use raphii_openvr_rs::raw;
use std::ffi::CString;

const FORMAT: vk::Format = vk::Format::R8G8B8A8_UNORM;

/// Renders imgui frames offscreen with Vulkan and submits them to an OpenVR overlay.
/// Lives on one thread for its whole life, together with the `NativeUi` it renders.
/// Its device is never destroyed: OpenVR must shut down before a texture's Vulkan objects go.
pub struct Renderer {
    imgui: Option<AshRenderer>,
    _entry: Entry,
    instance: Instance,
    physical_device: vk::PhysicalDevice,
    device: Device,
    queue: vk::Queue,
    queue_family: u32,
    width: u32,
    height: u32,
    // null until `init` creates them
    memory: vk::DeviceMemory,
    image: vk::Image,
    view: vk::ImageView,
    render_pass: vk::RenderPass,
    framebuffer: vk::Framebuffer,
    command_pool: vk::CommandPool,
    command_buffer: vk::CommandBuffer,
    fence: vk::Fence,
}

impl Renderer {
    /// Creates the Vulkan device on the headset's GPU, with the extensions SteamVR needs.
    /// Call `attach` before rendering.
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        Self::create(width, height, Some(&SteamVr::connect()?))
    }

    /// Without `steamvr`, uses the first Vulkan device and no extra extensions.
    fn create(width: u32, height: u32, steamvr: Option<&SteamVr>) -> Result<Self, String> {
        // load vulkan at runtime, so a missing driver is an error rather than a crash
        let entry = unsafe { Entry::load() }.map_err(message)?;
        let extensions = match steamvr {
            Some(steamvr) => steamvr.instance_extensions()?,
            None => Vec::new(),
        };
        let application = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_1);
        let instance = unsafe {
            entry.create_instance(
                &vk::InstanceCreateInfo::default()
                    .application_info(&application)
                    .enabled_extension_names(&pointers(&extensions)),
                None,
            )
        }
        .map_err(message)?;

        let (physical_device, queue_family, device) = match open_device(&instance, steamvr) {
            Ok(opened) => opened,
            Err(error) => {
                unsafe { instance.destroy_instance(None) };
                return Err(error);
            }
        };
        let mut renderer = Self {
            imgui: None,
            _entry: entry,
            queue: unsafe { device.get_device_queue(queue_family, 0) },
            instance,
            physical_device,
            device,
            queue_family,
            width,
            height,
            memory: vk::DeviceMemory::null(),
            image: vk::Image::null(),
            view: vk::ImageView::null(),
            render_pass: vk::RenderPass::null(),
            framebuffer: vk::Framebuffer::null(),
            command_pool: vk::CommandPool::null(),
            command_buffer: vk::CommandBuffer::null(),
            fence: vk::Fence::null(),
        };
        unsafe { renderer.init() }.map_err(message)?;
        Ok(renderer)
    }

    unsafe fn init(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let device = &self.device;

        // image SteamVR copies from, so it needs transfer source and sampled usage
        self.image = device.create_image(
            &vk::ImageCreateInfo::default()
                .image_type(vk::ImageType::TYPE_2D)
                .format(FORMAT)
                .extent(vk::Extent3D {
                    width: self.width,
                    height: self.height,
                    depth: 1,
                })
                .mip_levels(1)
                .array_layers(1)
                .samples(vk::SampleCountFlags::TYPE_1)
                .usage(
                    vk::ImageUsageFlags::COLOR_ATTACHMENT
                        | vk::ImageUsageFlags::TRANSFER_SRC
                        | vk::ImageUsageFlags::SAMPLED,
                ),
            None,
        )?;
        let requirements = device.get_image_memory_requirements(self.image);
        self.memory = device.allocate_memory(
            &vk::MemoryAllocateInfo::default()
                .allocation_size(requirements.size)
                .memory_type_index(self.device_local_memory(requirements.memory_type_bits)?),
            None,
        )?;
        device.bind_image_memory(self.image, self.memory, 0)?;
        self.view = device.create_image_view(
            &vk::ImageViewCreateInfo::default()
                .image(self.image)
                .view_type(vk::ImageViewType::TYPE_2D)
                .format(FORMAT)
                .subresource_range(vk::ImageSubresourceRange {
                    aspect_mask: vk::ImageAspectFlags::COLOR,
                    level_count: 1,
                    layer_count: 1,
                    ..Default::default()
                }),
            None,
        )?;

        // render pass that leaves the image in the layout SteamVR expects
        let attachments = [vk::AttachmentDescription::default()
            .format(FORMAT)
            .samples(vk::SampleCountFlags::TYPE_1)
            .load_op(vk::AttachmentLoadOp::CLEAR)
            .store_op(vk::AttachmentStoreOp::STORE)
            .initial_layout(vk::ImageLayout::UNDEFINED)
            .final_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)];
        let color = [vk::AttachmentReference {
            attachment: 0,
            layout: vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        }];
        let subpasses = [vk::SubpassDescription::default()
            .pipeline_bind_point(vk::PipelineBindPoint::GRAPHICS)
            .color_attachments(&color)];
        let dependencies = [vk::SubpassDependency::default()
            .src_subpass(0)
            .dst_subpass(vk::SUBPASS_EXTERNAL)
            .src_stage_mask(vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT)
            .src_access_mask(vk::AccessFlags::COLOR_ATTACHMENT_WRITE)
            .dst_stage_mask(vk::PipelineStageFlags::TRANSFER)
            .dst_access_mask(vk::AccessFlags::TRANSFER_READ)];
        self.render_pass = device.create_render_pass(
            &vk::RenderPassCreateInfo::default()
                .attachments(&attachments)
                .subpasses(&subpasses)
                .dependencies(&dependencies),
            None,
        )?;
        self.framebuffer = device.create_framebuffer(
            &vk::FramebufferCreateInfo::default()
                .render_pass(self.render_pass)
                .attachments(&[self.view])
                .width(self.width)
                .height(self.height)
                .layers(1),
            None,
        )?;

        // one command buffer, and a fence to wait for each frame
        self.command_pool = device.create_command_pool(
            &vk::CommandPoolCreateInfo::default()
                .queue_family_index(self.queue_family)
                .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER),
            None,
        )?;
        self.command_buffer = device.allocate_command_buffers(
            &vk::CommandBufferAllocateInfo::default()
                .command_pool(self.command_pool)
                .level(vk::CommandBufferLevel::PRIMARY)
                .command_buffer_count(1),
        )?[0];
        self.fence = device.create_fence(&vk::FenceCreateInfo::default(), None)?;
        Ok(())
    }

    /// Creates the imgui backend for `ui`. Call `detach` before attaching another `NativeUi`.
    pub fn attach(&mut self, ui: &mut NativeUi) -> Result<(), String> {
        let config = AshRendererConfig::with_render_pass(
            self.device.clone(),
            self.queue,
            self.command_pool,
            self.render_pass,
        );
        let imgui = unsafe {
            AshRenderer::with_default_allocator(
                &self.instance,
                self.physical_device,
                config,
                &mut ui.context,
            )
        };
        self.imgui = Some(imgui.map_err(message)?);
        Ok(())
    }

    /// Builds one frame with `draw`, renders it, and returns what `draw` returned.
    /// Returns once the GPU has finished the frame.
    pub fn render<R>(
        &mut self,
        ui: &mut NativeUi,
        draw: impl FnOnce(&Ui) -> R,
    ) -> Result<R, String> {
        let imgui = self
            .imgui
            .as_mut()
            .ok_or("Renderer has no NativeUi attached")?;
        let value = draw(ui.context.try_frame().map_err(message)?);
        let pending = ui
            .context
            .try_render(imgui.renderer_consumer().map_err(message)?)
            .map_err(message)?;
        let (frame, retirement) = imgui.prepare_frame(pending).map_err(message)?;

        // record and submit the frame, then wait for it
        let device = &self.device;
        let command_buffer = self.command_buffer;
        unsafe {
            device
                .begin_command_buffer(
                    command_buffer,
                    &vk::CommandBufferBeginInfo::default()
                        .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT),
                )
                .map_err(message)?;
            device.cmd_begin_render_pass(
                command_buffer,
                &vk::RenderPassBeginInfo::default()
                    .render_pass(self.render_pass)
                    .framebuffer(self.framebuffer)
                    .render_area(
                        vk::Extent2D::default()
                            .width(self.width)
                            .height(self.height)
                            .into(),
                    )
                    .clear_values(&[vk::ClearValue::default()]),
                vk::SubpassContents::INLINE,
            );
            imgui.cmd_draw(command_buffer, frame).map_err(message)?;
            device.cmd_end_render_pass(command_buffer);
            device.end_command_buffer(command_buffer).map_err(message)?;
            device
                .queue_submit(
                    self.queue,
                    &[vk::SubmitInfo::default().command_buffers(&[command_buffer])],
                    self.fence,
                )
                .map_err(message)?;
            device
                .wait_for_fences(&[self.fence], true, u64::MAX)
                .map_err(message)?;
            device.reset_fences(&[self.fence]).map_err(message)?;
        }

        if let Some(batch) = retirement {
            imgui.wait_for_texture_retirements(batch).map_err(message)?;
        }
        Ok(value)
    }

    /// Hands the last rendered frame to `overlay`.
    pub fn submit(&self, table: &raw::VR_IVROverlay_FnTable, overlay: u64) -> Result<(), String> {
        let mut data = raw::VRVulkanTextureData_t {
            m_nImage: self.image.as_raw(),
            m_pDevice: self.device.handle().as_raw() as *mut _,
            m_pPhysicalDevice: self.physical_device.as_raw() as *mut _,
            m_pInstance: self.instance.handle().as_raw() as *mut _,
            m_pQueue: self.queue.as_raw() as *mut _,
            m_nQueueFamilyIndex: self.queue_family,
            m_nWidth: self.width,
            m_nHeight: self.height,
            m_nFormat: FORMAT.as_raw() as u32,
            m_nSampleCount: 1,
        };
        let mut texture = raw::Texture_t {
            handle: (&raw mut data).cast(),
            eType: raw::ETextureType::TextureType_Vulkan,
            eColorSpace: raw::EColorSpace::ColorSpace_Auto,
        };
        let set = table
            .SetOverlayTexture
            .ok_or("Missing OpenVR SetOverlayTexture")?;
        match unsafe { set(overlay, &mut texture) } {
            raw::EVROverlayError(0) => Ok(()),
            error => Err(format!("OpenVR overlay error {}", error.0)),
        }
    }

    /// Releases the imgui backend's GPU resources. Call it while `ui` is still alive.
    pub fn detach(&mut self, ui: &mut NativeUi) {
        if let Some(mut imgui) = self.imgui.take() {
            if let Err(error) = imgui.shutdown(&mut ui.context) {
                log::warn!("[NativeUi] Could not shut down the Vulkan renderer: {error}");
            }
        }
    }

    fn device_local_memory(&self, type_bits: u32) -> Result<u32, String> {
        let properties = unsafe {
            self.instance
                .get_physical_device_memory_properties(self.physical_device)
        };
        (0..properties.memory_type_count)
            .find(|&index| {
                type_bits & (1 << index) != 0
                    && properties.memory_types[index as usize]
                        .property_flags
                        .contains(vk::MemoryPropertyFlags::DEVICE_LOCAL)
            })
            .ok_or("No device local Vulkan memory".into())
    }
}

/// Picks the headset's GPU, or the first one without SteamVR, and opens its graphics queue.
fn open_device(
    instance: &Instance,
    steamvr: Option<&SteamVr>,
) -> Result<(vk::PhysicalDevice, u32, Device), String> {
    let physical_device = match steamvr {
        Some(steamvr) => steamvr.physical_device(instance.handle())?,
        None => *unsafe { instance.enumerate_physical_devices() }
            .map_err(message)?
            .first()
            .ok_or("No Vulkan device")?,
    };
    let queue_family =
        unsafe { instance.get_physical_device_queue_family_properties(physical_device) }
            .iter()
            .position(|family| family.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .ok_or("No Vulkan graphics queue")? as u32;
    let extensions = match steamvr {
        Some(steamvr) => steamvr.device_extensions(physical_device)?,
        None => Vec::new(),
    };
    let queues = [vk::DeviceQueueCreateInfo::default()
        .queue_family_index(queue_family)
        .queue_priorities(&[1.0])];
    let device = unsafe {
        instance.create_device(
            physical_device,
            &vk::DeviceCreateInfo::default()
                .queue_create_infos(&queues)
                .enabled_extension_names(&pointers(&extensions)),
            None,
        )
    }
    .map_err(message)?;
    Ok((physical_device, queue_family, device))
}

fn pointers(names: &[CString]) -> Vec<*const std::ffi::c_char> {
    names.iter().map(|name| name.as_ptr()).collect()
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
