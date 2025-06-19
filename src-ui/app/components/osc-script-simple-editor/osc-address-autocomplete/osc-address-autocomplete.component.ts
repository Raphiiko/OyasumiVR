import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { BehaviorSubject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import Fuse from 'fuse.js';
import { fade, vshrink } from 'src-ui/app/utils/animations';

export interface AutocompleteState {
  showResults: boolean;
  results: string[];
  focusedIndex: number;
  inputValue: string;
  previewValue: string | null;
  justSelected: boolean; // Flag to track if an item was just selected
}

export interface OscAddressSelection {
  address: string;
}

@Component({
  selector: 'app-osc-address-autocomplete',
  templateUrl: './osc-address-autocomplete.component.html',
  styleUrls: ['./osc-address-autocomplete.component.scss'],
  animations: [vshrink(), fade()],
  standalone: false,
})
export class OscAddressAutocompleteComponent implements OnInit, OnChanges {
  @Input() addresses: string[] = [];
  @Input() value: string = '';
  @Output() valueChange = new EventEmitter<string>();
  @Output() addressSelected = new EventEmitter<OscAddressSelection>();
  @ViewChild('addressInput') addressInput?: ElementRef<HTMLInputElement>;
  @ViewChild('resultsContainer') resultsContainer?: ElementRef<HTMLDivElement>;

  private isInitialLoad = true;
  isFocused = false;

  autocompleteState: AutocompleteState = {
    showResults: false,
    results: [],
    focusedIndex: -1,
    inputValue: '',
    previewValue: null,
    justSelected: false,
  };

  addressQuery: BehaviorSubject<string> = new BehaviorSubject<string>('');
  fuseSuggestions?: Fuse<string>;

  constructor(private destroyRef: DestroyRef) {}

  ngOnInit(): void {
    // Setup address search
    this.addressQuery
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(100), distinctUntilChanged())
      .subscribe((query) => this.searchAddresses(query));

    this.initializeFuse();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['addresses']) {
      this.initializeFuse();
    }

    if (changes['value']) {
      this.autocompleteState.inputValue = this.value;
      if (!this.autocompleteState.justSelected && !this.isInitialLoad) {
        this.addressQuery.next(this.value);
      }
      this.isInitialLoad = false;
    }
  }

  initializeFuse(): void {
    // Initialize Fuse for address suggestions
    const fuseOptions = {
      findAllMatches: true,
      threshold: 0.4,
      minMatchCharLength: 1,
      includeScore: true,
      keys: [
        {
          name: 'item',
          weight: 1,
        },
      ],
    };
    const fuseIndex = Fuse.createIndex([], this.addresses);
    this.fuseSuggestions = new Fuse(this.addresses, fuseOptions, fuseIndex);

    // Update suggestions if we have a current query
    if (this.autocompleteState.inputValue && !this.autocompleteState.justSelected) {
      this.addressQuery.next(this.autocompleteState.inputValue);
    }
  }

  searchAddresses(query: string): void {
    if (
      !this.fuseSuggestions ||
      !query.trim() ||
      this.autocompleteState.justSelected ||
      !this.isFocused
    ) {
      this.autocompleteState.results = [];
      this.autocompleteState.showResults = false;
      this.autocompleteState.previewValue = null;
      this.autocompleteState.focusedIndex = -1;
      return;
    }

    const results = this.fuseSuggestions.search(query.trim());
    // Sort results by score and then by length
    this.autocompleteState.results = results
      .sort((a, b) => {
        if (a.score === b.score) {
          return a.item.length - b.item.length;
        }
        return (a.score || 0) - (b.score || 0);
      })
      .map((result) => result.item);
    this.autocompleteState.showResults = this.autocompleteState.results.length > 0;

    // Don't highlight any result by default, let the user explicitly select
    this.autocompleteState.focusedIndex = -1;

    // Set preview value if there are results and the first one is a prefix match
    if (this.autocompleteState.results.length > 0 && query.trim()) {
      const firstResult = this.autocompleteState.results[0];
      if (firstResult.toLowerCase().startsWith(query.trim().toLowerCase())) {
        this.autocompleteState.previewValue = firstResult;
      } else {
        this.autocompleteState.previewValue = null;
      }
    } else {
      this.autocompleteState.previewValue = null;
    }
  }

  onInputChange(event: Event): void {
    const inputValue = (event.target as HTMLInputElement).value;
    this.value = inputValue;
    this.valueChange.emit(inputValue);
    this.autocompleteState.inputValue = inputValue;
    this.autocompleteState.focusedIndex = -1; // Reset focused index when typing
    this.autocompleteState.justSelected = false; // Reset the justSelected flag when typing
    this.addressQuery.next(inputValue);
  }

  onBlur(): void {
    this.isFocused = false;
    // Hide suggestions after a small delay to allow for clicking on a suggestion
    setTimeout(() => {
      this.autocompleteState.showResults = false;
      this.autocompleteState.previewValue = null;
      this.autocompleteState.focusedIndex = -1;
    }, 200);
  }

  onFocus(): void {
    this.isFocused = true;
    // Only show results if the user hasn't just selected an item
    if (!this.autocompleteState.justSelected) {
      this.autocompleteState.inputValue = this.value;
      this.addressQuery.next(this.value);
    } else {
      // Reset the flag after a short delay to allow future focus events to work
      setTimeout(() => {
        this.autocompleteState.justSelected = false;
      }, 300);
    }
  }

  selectAddress(address: string): void {
    this.value = address;
    this.valueChange.emit(address);

    // Emit selected address
    this.addressSelected.emit({ address });

    this.autocompleteState.inputValue = address;
    this.autocompleteState.showResults = false;
    this.autocompleteState.previewValue = null;
    this.autocompleteState.focusedIndex = -1;
    this.autocompleteState.justSelected = true; // Set flag to prevent dropdown from reopening

    // Focus the input after selection
    this.addressInput?.nativeElement.focus();
  }

  onKeydown(event: KeyboardEvent): void {
    // Check for Tab key to accept autocomplete
    if (event.key === 'Tab' && this.autocompleteState.previewValue) {
      event.preventDefault();
      this.selectAddress(this.autocompleteState.previewValue);
      return;
    }

    if (!this.autocompleteState.showResults) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.autocompleteState.focusedIndex = Math.min(
          this.autocompleteState.focusedIndex + 1,
          this.autocompleteState.results.length - 1
        );
        // Update preview with currently focused item
        if (this.autocompleteState.focusedIndex >= 0) {
          this.autocompleteState.previewValue =
            this.autocompleteState.results[this.autocompleteState.focusedIndex];
          this.scrollToFocusedItem();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.autocompleteState.focusedIndex = Math.max(this.autocompleteState.focusedIndex - 1, 0);
        // Update preview with currently focused item
        if (this.autocompleteState.focusedIndex >= 0) {
          this.autocompleteState.previewValue =
            this.autocompleteState.results[this.autocompleteState.focusedIndex];
          this.scrollToFocusedItem();
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (this.autocompleteState.focusedIndex >= 0) {
          this.selectAddress(this.autocompleteState.results[this.autocompleteState.focusedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.autocompleteState.showResults = false;
        this.autocompleteState.previewValue = null;
        this.autocompleteState.focusedIndex = -1;
        break;
    }
  }

  private scrollToFocusedItem(): void {
    if (!this.resultsContainer?.nativeElement) return;

    const container = this.resultsContainer.nativeElement;
    const focusedElement = container.children[this.autocompleteState.focusedIndex] as HTMLElement;
    if (!focusedElement) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = focusedElement.getBoundingClientRect();

    // Check if the element is outside the visible area
    if (elementRect.top < containerRect.top) {
      // Element is above the visible area
      container.scrollTop -= containerRect.top - elementRect.top;
    } else if (elementRect.bottom > containerRect.bottom) {
      // Element is below the visible area
      container.scrollTop += elementRect.bottom - containerRect.bottom;
    }
  }
}
