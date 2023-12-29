extern crate proc_macro;
extern crate quote;
extern crate syn;

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, parse_str, ItemFn};

#[proc_macro_attribute]
pub fn command_profiling(_args: TokenStream, input: TokenStream) -> TokenStream {
    let input_fn = parse_macro_input!(input as ItemFn);

    let ItemFn {
        attrs,
        vis,
        sig,
        block,
    } = input_fn;

    // Extract the function name
    let fn_name = &sig.ident;
    let fn_name_str = fn_name.to_string();

    // Create Identifiers from string literals
    let start_fn_path: syn::ExprPath = parse_str("crate::utils::profiling::profile_command_start")
        .expect("Failed to parse start function path");
    let end_fn_path: syn::ExprPath = parse_str("crate::utils::profiling::profile_command_finish")
        .expect("Failed to parse end function path");

    let new_body = quote! {
        {
            let __invocation_id = #start_fn_path(#fn_name_str).await;
            let result = (|| async #block)();
            #end_fn_path(__invocation_id);
            result.await
        }
    };

    let output = quote! {
        #(#attrs)*
        #vis #sig {
            #new_body
        }
    };

    output.into()
}
