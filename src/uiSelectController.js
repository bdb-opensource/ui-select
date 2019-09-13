/**
 * Contains ui-select "intelligence".
 *
 * The goal is to limit dependency on the DOM whenever possible and
 * put as much logic in the controller (instead of the link functions) as possible so it can be easily tested.
 */
uis.controller('uiSelectCtrl', [
  '$scope', '$element', '$timeout', '$filter', '$$uisDebounce', 'uisRepeatParser', 'uiSelectMinErr', 'uiSelectConfig',
  '$parse', '$window', uiSelectCtrl
]);

function uiSelectCtrl($scope, $element, $timeout, $filter, $$uisDebounce, RepeatParser, uiSelectMinErr, uiSelectConfig, $parse, $window) {
  //#region Declarations
  var ctrl = this; // jshint ignore:line
  var disabledItems = [];
  var EMPTY_SEARCH = '';
  var onResize = $$uisDebounce(sizeSearchInput, 50);
  var refreshDelayPromise;
  var sizeWatch = null;
  var updaterScheduled = false;
  ctrl.$element = $element;
  ctrl.$filter = $filter;
  ctrl.activeIndex = 0; //Dropdown of choices
  ctrl.clickTriggeredSelect = false;
  ctrl.closeOnSelect = true; //Initialized inside uiSelect directive link function
  ctrl.disableChoiceExpression = undefined; // Initialized inside uiSelectChoices directive link function
  ctrl.disabled = false;
  ctrl.dropdownPosition = 'auto';
  ctrl.focus = false;
  ctrl.focusser = undefined; //Reference to input element used to handle focus events
  ctrl.items = []; //All available choices
  ctrl.lockChoiceExpression = undefined; // Initialized inside uiSelectMatch directive link function
  ctrl.multiple = undefined; // Initialized inside uiSelect directive link function
  ctrl.nullLabel = uiSelectConfig.nullLabel;
  ctrl.nullValue = uiSelectConfig.nullValue;
  ctrl.open = false;
  ctrl.paste = uiSelectConfig.paste;
  ctrl.placeholder = uiSelectConfig.placeholder;
  ctrl.refreshDelay = uiSelectConfig.refreshDelay;
  ctrl.refreshing = false;
  ctrl.removeSelected = uiSelectConfig.removeSelected; //If selected item(s) should be removed from dropdown list
  ctrl.resetSearchInput = uiSelectConfig.resetSearchInput;
  ctrl.search = EMPTY_SEARCH;
  ctrl.searchEnabled = uiSelectConfig.searchEnabled;
  ctrl.searchInput = $element.querySelectorAll('input.ui-select-search');
  ctrl.selected = undefined;
  ctrl.skipFocusser = false; //Set to true to avoid returning focus to ctrl when item is selected
  ctrl.sortable = uiSelectConfig.sortable;
  ctrl.spinnerClass = uiSelectConfig.spinnerClass;
  ctrl.spinnerEnabled = uiSelectConfig.spinnerEnabled;
  ctrl.tagging = {isActivated: false, fct: undefined};
  ctrl.taggingTokens = {isActivated: false, tokens: undefined};
  //#endregion

  //#region Controller Interface
  ctrl.activate = activate;
  ctrl.cancelEvent = cancelEvent;
  ctrl.clear = clear;
  ctrl.close = close;
  ctrl.findGroupByName = findGroupByName;
  ctrl.focusSearchInput = focusSearchInput;
  ctrl.getPlaceholder = getPlaceholder;
  ctrl.getSelectedText = getSelectedText;
  ctrl.isActive = isActive;
  ctrl.isDisabled = isDisabled;
  ctrl.isEmpty = isEmpty;
  ctrl.isLocked = function() { return false; }; // Overwritten: assume unlocked until _initaliseLockedChoices
  ctrl.parseRepeatAttr = parseRepeatAttr;
  ctrl.refresh = refresh;
  ctrl.refreshItems = angular.noop; // Overwritten: do nothing until parseRepeatAttr is called
  ctrl.select = select;
  ctrl.setFocus = setFocus;
  ctrl.sizeSearchInput = sizeSearchInput;
  ctrl.tabNavigate = tabNavigate;
  ctrl.toggle = toggle;
  //#endregion

  //#region Initialization
  if (ctrl.searchInput.length !== 1) {
    throw uiSelectMinErr('searchInput', "Expected 1 input.ui-select-search but got '{0}'.", ctrl.searchInput.length);
  }

  angular.element($window).on('resize', onResize);
  ctrl.searchInput.on('keydown', onSearchInputKeyDown);
  ctrl.searchInput.on('paste', onSearchInputPaste);
  ctrl.searchInput.on('tagged', onSearchInputTagged);
  $scope.$on('$destroy', onDestroy);
  $scope.$watch(isLockChoiceExpressionDefined, _initaliseLockedChoices);
  $scope.$watch('$select.activeIndex', onActiveIndexChange);
  $scope.$watch('$select.open', onOpenChange);
  //#endregion

  //#region Controller Functions
  function isEmpty() {
    return isNil(ctrl.selected) || ctrl.selected === '' || ctrl.selected.$$null || (ctrl.multiple && ctrl.selected.length === 0);
  }

  function getSelectedText() {
    return ctrl.$element.find('.ui-select-match-text').text();
  }

  function getPlaceholder() {
    if (ctrl.selected && ctrl.selected.length) { return; }

    return ctrl.placeholder;
  }

  function _findIndex(collection, predicate, thisArg) {
    if (collection.findIndex) {
      return collection.findIndex(predicate, thisArg);
    } else {
      var list = Object(collection);
      var length = list.length >>> 0;
      var value;

      for (var i = 0; i < length; i++) {
        value = list[i];
        if (predicate.call(thisArg, value, i, list)) {
          return i;
        }
      }
      return -1;
    }
  }

  // Most of the time the user does not want to empty the search input when in typeahead mode
  function _resetSearchInput() {
    if (ctrl.resetSearchInput) {
      ctrl.search = EMPTY_SEARCH;
      setActiveIndexToSelected();
    }
  }

  function setActiveIndexToSelected() {
    // Don't change activeIndex to selected if we can select multiple items
    if (ctrl.multiple) { return; }

    // If we have a track by expression, use that to find the selected item since it might be a copy/different
    // prototype. Otherwise, do equality checks.
    var active = -1;
    var selected = ctrl.selected;
    if (angular.equals(selected, ctrl.nullValue)) {
      active = _findIndex(ctrl.items, isNullValue);
    } else if (ctrl.items.length) {
      var trackBy = ctrl.parserResult && ctrl.parserResult.trackByExp;
      var trackSkipFirst = trackBy ? trackBy.indexOf('.') : -1;
      var getter = trackSkipFirst > -1 ? $parse(trackBy.slice(trackSkipFirst + 1)) : function(obj) { return obj; };
      var trackedValue = getter(selected);
      active = _findIndex(ctrl.items, function(item) {
        return angular.equals(getter(item), trackedValue);
      });
    }

    // If we don't have an active index, select first enabled non-generated null item.
    if (active < 0) {
      active = _findIndex(ctrl.items, function(item) {
        return !item.$$null && !_isItemDisabled(item);
      });
    }

    ctrl.activeIndex = active;
  }

  function _groupsFilter(groups, groupNames) {
    for (var i = 0, j, result = []; i < groupNames.length; i++) {
      for (j = 0; j < groups.length; j++) {
        if (groups[j].name == [groupNames[i]]) {
          result.push(groups[j]);
        }
      }
    }

    return result;
  }

  function isNullValue(item) {
    return item.$$null || angular.equals(item[ctrl.itemProperty], ctrl.nullValue);
  }

  // When the user clicks on ui-select, displays the dropdown list
  function activate(initSearchValue, avoidReset) {
    if (!ctrl.disabled && !ctrl.open) {
      if (!avoidReset) {
        _resetSearchInput();
      }

      $scope.$broadcast('uis:activate');
      ctrl.open = true;

      // Tagging label variant should select the first item
      if (ctrl.taggingLabel) {
        ctrl.activeIndex = 0;
      } else {
        setActiveIndexToSelected();
      }

      $timeout(function() {
        ctrl.focusSearchInput(initSearchValue);
        if (!ctrl.tagging.isActivated && ctrl.items.length > 1 && ctrl.open) {
          _ensureHighlightVisible();
        }
      });
    } else if (ctrl.open && !ctrl.searchEnabled) {
      // Close the selection if we don't have search enabled, and we click on the select again
      ctrl.close();
    }
  }

  function focusSearchInput(initSearchValue) {
    ctrl.search = initSearchValue || ctrl.search;
    ctrl.searchInput[0].focus();
  }

  function findGroupByName(name, noStrict) {
    return ctrl.groups && ctrl.groups.filter(function(group) {
      if (noStrict) {
        return group.name == name;
      } else {
        return group.name === name;
      }
    })[0];
  }

  function parseRepeatAttr(repeatAttr, groupByExp, groupFilterExp) {
    var parserResult = RepeatParser.parse(repeatAttr);
    var originalSource = parserResult.source;
    ctrl.isGrouped = !!groupByExp;
    ctrl.itemProperty = parserResult.itemName;
    ctrl.parserResult = parserResult;
    ctrl.refreshItems = refreshItems;
    ctrl.setItemsFn = groupByExp ? updateGroups : updateFlatItems;

    if (parserResult.keyName) { // Check for (key,value) syntax
      createArrayFromObject();
      parserResult.source = $parse('$uisSource' + parserResult.filters);
      $scope.$watch(originalSource, onOriginalSourceChange, true);
    }

    // See https://github.com/angular/angular.js/blob/v1.2.15/src/ng/directive/ngRepeat.js#L259
    $scope.$watchCollection(parserResult.source, onSourceChange);

    //When an object is used as source, we better create an array and use it as 'source'
    function createArrayFromObject() {
      var origSrc = originalSource($scope);
      $scope.$uisSource = Object.keys(origSrc).map(function(v) {
        var result = {};
        result[ctrl.parserResult.keyName] = v;
        result.value = origSrc[v];
        return result;
      });
    }

    function createNullItem() {
      var nullItem = {$$null: true};
      nullItem[ctrl.itemProperty] = ctrl.nullValue;
      return nullItem;
    }

    function needsNullItem(items) {
      return !ctrl.taggingLabel && !ctrl.required && !items.some(isNullValue);
    }

    function onOriginalSourceChange(newVal, oldVal) {
      if (newVal !== oldVal) {
        createArrayFromObject();
      }
    }

    function onSourceChange(items) {
      if (isNil(items)) {
        // If the user specifies undefined or null => reset the collection
        // Special case: items can be undefined if the user did not initialized the collection on the scope
        // i.e $scope.addresses = [] is missing
        ctrl.items = [];
      } else if (!angular.isArray(items)) {
        throw uiSelectMinErr('items', "Expected an array but got '{0}'.", items);
      } else {
        //Remove already selected items (ex: while searching)
        ctrl.refreshItems(items);

        //update the view value with fresh data from items, if there is a valid model value
        if (angular.isDefined(ctrl.ngModel.$modelValue)) {
          ctrl.ngModel.$modelValue = null; //Force scope model value and ngModel value to be out of sync to re-run formatters
        }
      }
    }

    function refreshItems(data) {
      //TODO should implement for single mode removeSelected
      var selectedItems = ctrl.selected;
      data = data || ctrl.parserResult.source($scope) || ctrl.items || [];
      if (!ctrl.multiple || !ctrl.removeSelected || ctrl.isEmpty() || (angular.isArray(selectedItems) && !selectedItems.length)) {
        ctrl.setItemsFn(data);
      } else if (!isNil(data)) {
        ctrl.setItemsFn(data.filter(excludeSelected));
      }

      if (ctrl.dropdownPosition === 'auto' || ctrl.dropdownPosition === 'up') {
        $scope.calculateDropdownPos();
      }

      $scope.$broadcast('uis:refresh');

      function excludeSelected(item) {
        return angular.isArray(selectedItems) ? selectedItems.every(isNotSelected) : isNotSelected(selectedItems);

        function isNotSelected(selectedItem) {
          return !angular.equals(item, selectedItem);
        }
      }
    }

    function updateFlatItems(items) {
      ctrl.items = items;

      // Insert our null item at the head of the items
      if (needsNullItem(items)) {
        items.unshift(createNullItem());
      }
    }

    function updateGroups(items) {
      items = items || ctrl.items;

      // Group items together by the group by expression
      var groupFn = $scope.$eval(groupByExp);
      ctrl.items = [];
      ctrl.groups = [];
      items.forEach(function(item) {
        var groupName = angular.isFunction(groupFn) ? groupFn(item) : item[groupFn];
        var group = ctrl.findGroupByName(groupName);
        if (group) {
          group.items.push(item);
        } else {
          ctrl.groups.push({name: groupName, items: [item]});
        }
      });

      // Filter the groups by the given filter expression
      var groupFilterFn = groupFilterExp && $scope.$eval(groupFilterExp);
      if (angular.isFunction(groupFilterFn)) {
        ctrl.groups = groupFilterFn(ctrl.groups);
      } else if (angular.isArray(groupFilterFn)) {
        ctrl.groups = _groupsFilter(ctrl.groups, groupFilterFn);
      }

      // Collect the remaining items in the same order of the filtered groups.
      items = ctrl.items = ctrl.groups.reduce(function(items, group) {
        return items.concat(group.items);
      }, []);

      // Insert our null item at the head of the list if we dont have an item that represents null.
      if (needsNullItem(items)) {
        var group = ctrl.groups[0] || (ctrl.groups[0] = {name: '', items: []});
        var nullItem = createNullItem();
        group.items.unshift(nullItem);
        items.unshift(nullItem);
      }
    }
  }

  /**
   * Typeahead mode: lets the user refresh the collection using his own function.
   *
   * See Expose $select.search for external / remote filtering https://github.com/angular-ui/ui-select/pull/31
   */
  function refresh(refreshAttr) {
    if (!isNil(refreshAttr)) {
      // Debounce
      // See https://github.com/angular-ui/bootstrap/blob/0.10.0/src/typeahead/typeahead.js#L155
      // FYI AngularStrap typeahead does not have debouncing: https://github.com/mgcrea/angular-strap/blob/v2.0.0-rc.4/src/typeahead/typeahead.js#L177
      if (refreshDelayPromise) {
        $timeout.cancel(refreshDelayPromise);
      }

      refreshDelayPromise = $timeout(function() {
        if ($scope.$select.search.length >= $scope.$select.minimumInputLength) {
          var refreshPromise = $scope.$eval(refreshAttr);
          if (refreshPromise && angular.isFunction(refreshPromise.then) && !ctrl.refreshing) {
            ctrl.refreshing = true;
            refreshPromise.finally(function() {
              ctrl.refreshing = false;
            });
          }
        }
      }, ctrl.refreshDelay);
    }
  }

  function isActive(itemScope) {
    if (!ctrl.open) { return false; }

    var itemIndex = ctrl.items.indexOf(itemScope[ctrl.itemProperty]);
    var isActive = itemIndex == ctrl.activeIndex;
    if (!isActive || itemIndex < 0) { return false; }

    if (isActive && !angular.isUndefined(ctrl.onHighlightCallback)) {
      itemScope.$eval(ctrl.onHighlightCallback);
    }

    return isActive;
  }

  function _isItemSelected(item) {
    return (angular.isArray(ctrl.selected) && ctrl.selected.filter(function(selection) {
      return angular.equals(selection, item);
    }).length > 0);
  }

  function _updateItemDisabled(item, isDisabled) {
    var disabledItemIndex = disabledItems.indexOf(item);
    if (isDisabled && disabledItemIndex === -1) {
      disabledItems.push(item);
    }

    if (!isDisabled && disabledItemIndex > -1) {
      disabledItems.splice(disabledItemIndex, 1);
    }
  }

  function _isItemDisabled(item) {
    return disabledItems.indexOf(item) > -1;
  }

  function isDisabled(itemScope) {
    if (!ctrl.open) { return; }

    var item = itemScope[ctrl.itemProperty];
    var itemIndex = ctrl.items.indexOf(item);
    var isDisabled = false;
    if (itemIndex >= 0 && (angular.isDefined(ctrl.disableChoiceExpression) || ctrl.multiple)) {
      if (item.isTag) { return false; }

      if (ctrl.multiple) {
        isDisabled = _isItemSelected(item);
      }

      if (!isDisabled && angular.isDefined(ctrl.disableChoiceExpression)) {
        isDisabled = !!(itemScope.$eval(ctrl.disableChoiceExpression));
      }

      _updateItemDisabled(item, isDisabled);
    }

    return isDisabled;
  }

  // When the user selects an item with ENTER or clicks the dropdown
  function select(item, skipFocusser, $event) {
    if (isNil(item) || !_isItemDisabled(item)) {
      if (!ctrl.items && !ctrl.search && !ctrl.tagging.isActivated) { return; }

      if (!item || !_isItemDisabled(item)) {
        // if click is made on existing item, prevent from tagging, ctrl.search does not matter
        ctrl.clickTriggeredSelect = false;
        if ($event && ($event.type === 'click' || $event.type === 'touchend') && item) {
          ctrl.clickTriggeredSelect = true;
        }

        if (ctrl.tagging.isActivated && ctrl.clickTriggeredSelect === false) {
          // if taggingLabel is disabled and item is undefined we pull from ctrl.search
          if (ctrl.taggingLabel === false) {
            if (ctrl.activeIndex < 0) {
              if (item === undefined) {
                item = ctrl.tagging.fct !== undefined ? ctrl.tagging.fct(ctrl.search) : ctrl.search;
              }

              if (!item || angular.equals(ctrl.items[0], item)) { return; }
            } else {
              // keyboard nav happened first, user selected from dropdown
              item = ctrl.items[ctrl.activeIndex];
            }
          } else {
            // tagging always operates at index zero, taggingLabel === false pushes
            // the ctrl.search value without having it injected
            if (ctrl.activeIndex === 0) {
              // ctrl.tagging pushes items to ctrl.items, so we only have empty val
              // for `item` if it is a detected duplicate
              if (item === undefined) { return; }

              // create new item on the fly if we don't already have one;
              // use tagging function if we have one
              if (ctrl.tagging.fct !== undefined && typeof item === 'string') {
                item = ctrl.tagging.fct(item);
                if (!item)  { return; }
                // if item type is 'string', apply the tagging label
              } else if (typeof item === 'string') {
                // trim the trailing space
                item = item.replace(ctrl.taggingLabel, '').trim();
              }
            }
          }
          // search ctrl.selected for dupes potentially caused by tagging and return early if found
          if (_isItemSelected(item)) {
            ctrl.close(skipFocusser);
            return;
          }
        }

        _resetSearchInput();
        $scope.$broadcast('uis:select', item);

        if (ctrl.closeOnSelect) {
          ctrl.close(skipFocusser);
        }
      }
    }
  }

  // Closes the dropdown
  function close(skipFocusser) {
    if (!ctrl.open) { return; }

    if (ctrl.ngModel && ctrl.ngModel.$setTouched) {
      ctrl.ngModel.$setTouched();
    }

    ctrl.open = false;
    _resetSearchInput();
    $scope.$broadcast('uis:close', skipFocusser);
  }


  function setFocus() {
    if (!ctrl.focus) {
      ctrl.focusInput[0].focus();
    }
  }

  function clear($event) {
    ctrl.select(ctrl.nullValue);
    $event.stopPropagation();
    $timeout(function() {
      ctrl.focusser[0].focus();
    }, 0, false);
  }

  // Toggle dropdown
  function toggle(e) {
    if (ctrl.open) {
      ctrl.close();
    } else {
      ctrl.activate();
    }

    cancelEvent(e);
  }

  function _initaliseLockedChoices(doInitalise) {
    if (!doInitalise) { return; }

    var lockedItems = [];
    ctrl.isLocked = isLockedFn;

    function _updateItemLocked(item, isLocked) {
      var lockedItemIndex = lockedItems.indexOf(item);
      if (isLocked && lockedItemIndex === -1) {
        lockedItems.push(item);
      }

      if (!isLocked && lockedItemIndex > -1) {
        lockedItems.splice(lockedItemIndex, 1);
      }
    }

    function _isItemlocked(item) {
      return lockedItems.indexOf(item) > -1;
    }

    function isLockedFn(itemScope, itemIndex) {
      var isLocked = false;
      var item = ctrl.selected[itemIndex];

      if (item) {
        if (itemScope) {
          isLocked = !!itemScope.$eval(ctrl.lockChoiceExpression);
          _updateItemLocked(item, isLocked);
        } else {
          isLocked = _isItemlocked(item);
        }
      }

      return isLocked;
    }
  }

  function sizeSearchInput() {
    var input = ctrl.searchInput[0];
    var container = ctrl.$element[0];
    ctrl.searchInput.css('width', '10px');
    $timeout(function() { //Give tags time to render correctly
      if (sizeWatch === null && !updateIfVisible(calculateContainerWidth())) {
        sizeWatch = $scope.$watch(function() {
          if (!updaterScheduled) {
            updaterScheduled = true;
            $scope.$$postDigest(function() {
              updaterScheduled = false;
              if (updateIfVisible(calculateContainerWidth())) {
                sizeWatch();
                sizeWatch = null;
              }
            });
          }
        }, angular.noop);
      }
    });

    function calculateContainerWidth() {
      // Return the container width only if the search input is visible
      return container.clientWidth * !!input.offsetParent;
    }

    function updateIfVisible(containerWidth) {
      if (containerWidth === 0) { return false; }

      var inputWidth = containerWidth - input.offsetLeft;
      if (inputWidth < 50) {
        inputWidth = containerWidth;
      }

      ctrl.searchInput.css('width', inputWidth + 'px');
      return true;
    }
  }

  function _handleDropDownSelection(key, shiftKey) {
    var processed = true;
    switch (key) {
      case KEY.DOWN:
        if (!ctrl.open && ctrl.multiple) {
          ctrl.activate(false, true); //In case its the search input in 'multiple' mode
        } else if (ctrl.activeIndex < ctrl.items.length - 1) {
          var idx = ++ctrl.activeIndex;
          while (_isItemDisabled(ctrl.items[idx]) && idx < ctrl.items.length) {
            ctrl.activeIndex = ++idx;
          }
        }

        break;
      case KEY.UP:
        if (!ctrl.open && ctrl.multiple) {
          // In case its the search input in 'multiple' mode
          ctrl.activate(false, true);
        } else if (ctrl.items.length) {
          // Move up in the index, skipping over disabled items
          for (var index = ctrl.activeIndex - 1; index > 0 && _isItemDisabled(ctrl.items[index]); --index) {}

          // Ensure inbounds and skip over if the selected index is $$null.
          if (index >= (!ctrl.multiple && ctrl.isEmpty() ? 1 : 0)) {
            ctrl.activeIndex = index;
          }
        }

        break;
      case KEY.TAB:
        if (!ctrl.multiple || ctrl.open) {
          ctrl.select(ctrl.items[ctrl.activeIndex], true);
          ctrl.tabNavigate(shiftKey);
        }

        break;
      case KEY.ENTER:
        if (ctrl.open && (ctrl.tagging.isActivated || ctrl.activeIndex >= 0)) {
          // Make sure at least one dropdown item is highlighted before adding if not in tagging mode
          ctrl.select(ctrl.items[ctrl.activeIndex], ctrl.skipFocusser);
        } else {
          //In case its the search input in 'multiple' mode
          ctrl.activate(false, true);
        }

        break;
      case KEY.ESC:
        ctrl.close();
        break;
      default:
        processed = false;
    }
    return processed;
  }

  function cancelEvent(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function tabNavigate(shiftKey) {
    $timeout(function() {
      var focusEl = ctrl.focusser && ctrl.focusser[0];
      if (!focusEl) { return; }

      var focusable = angular.element(':tabbable');
      var index = focusable.index(focusEl);
      if (index > -1) {
        var el = focusable[index + (shiftKey ? -1 : 1)];
        if (el) {
          el.focus();
        }
      }
    }, 10);
  }

  function onSearchInputKeyDown(e) {
    var key = e.which;
    if (~[KEY.ENTER, KEY.ESC, KEY.TAB].indexOf(key)) {
      cancelEvent(e);
    }

    $scope.$apply(function() {
      var tagged = false;
      if (ctrl.items.length > 0 || ctrl.tagging.isActivated) {
        if (!_handleDropDownSelection(key, e.shiftKey) && !ctrl.searchEnabled) {
          cancelEvent(e);
        }

        if (ctrl.taggingTokens.isActivated) {
          for (var i = 0; i < ctrl.taggingTokens.tokens.length; i++) {
            if (ctrl.taggingTokens.tokens[i] === KEY.MAP[e.keyCode]) {
              // make sure there is a new value to push via tagging
              if (ctrl.search.length > 0) {
                tagged = true;
              }
            }
          }

          if (tagged) {
            $timeout(function() {
              ctrl.searchInput.triggerHandler('tagged');
              var newItem = ctrl.search.replace(KEY.MAP[e.keyCode], '').trim();
              if (ctrl.tagging.fct) {
                newItem = ctrl.tagging.fct(newItem);
              }

              if (newItem) {
                ctrl.select(newItem, true);
              }
            });
          }
        }
      } else if (key === KEY.TAB) {
        // Don't trap users in lists with no items
        ctrl.tabNavigate(e.shiftKey);
      }
    });

    if (KEY.isVerticalMovement(key) && ctrl.items.length > 0) {
      _ensureHighlightVisible();
    }
  }

  function onSearchInputPaste(e) {
    var data;
    if (window.clipboardData && window.clipboardData.getData) { // IE
      data = window.clipboardData.getData('Text');
    } else {
      data = (e.originalEvent || e).clipboardData.getData('text/plain');
    }

    // Prepend the current input field text to the paste buffer.
    data = ctrl.search + data;
    if (data && data.length > 0) {
      // If tagging try to split by tokens and add items
      if (ctrl.taggingTokens.isActivated) {
        var items = [];
        for (var i = 0; i < ctrl.taggingTokens.tokens.length; i++) {  // split by first token that is contained in data
          var separator = KEY.toSeparator(ctrl.taggingTokens.tokens[i]) || ctrl.taggingTokens.tokens[i];
          if (data.indexOf(separator) > -1) {
            items = data.split(separator);
            break;  // only split by one token
          }
        }

        if (items.length === 0) {
          items = [data];
        }

        var oldsearch = ctrl.search;
        items.forEach(function(item) {
          var newItem = ctrl.tagging.fct ? ctrl.tagging.fct(item) : item;
          if (newItem) {
            ctrl.select(newItem, true);
          }
        });
        ctrl.search = oldsearch || EMPTY_SEARCH;
        cancelEvent(e);
      } else if (ctrl.paste) {
        ctrl.paste(data);
        ctrl.search = EMPTY_SEARCH;
        cancelEvent(e);
      }
    }
  }

  function onSearchInputTagged() {
    $timeout(_resetSearchInput);
  }

  // See https://github.com/ivaynberg/select2/blob/3.4.6/select2.js#L1431
  function _ensureHighlightVisible() {
    var container = $element.querySelectorAll('.ui-select-choices-content');
    var choices = container.querySelectorAll('.ui-select-choices-row');
    if (choices.length < 1) {
      throw uiSelectMinErr('choices', "Expected multiple .ui-select-choices-row but got '{0}'.", choices.length);
    }

    // Bail out if we can't find the highlighted row.
    var highlighted = choices[ctrl.activeIndex];
    if (!highlighted) { return; }

    var posY = highlighted.offsetTop + highlighted.clientHeight - container[0].scrollTop;
    var height = container[0].offsetHeight;
    if (posY > height) {
      container[0].scrollTop += posY - height;
    } else if (posY < highlighted.clientHeight) {
      if (ctrl.isGrouped && ctrl.activeIndex === 0) {
        container[0].scrollTop = 0; //To make group header visible when going all the way up
      } else {
        container[0].scrollTop -= highlighted.clientHeight - posY;
      }
    }
  }

  function isLockChoiceExpressionDefined() {
    return angular.isDefined(ctrl.lockChoiceExpression) && ctrl.lockChoiceExpression !== "";
  }

  function onActiveIndexChange(activeIndex) {
    if (activeIndex) {
      $element.find('input').attr(
        'aria-activedescendant',
        'ui-select-choices-row-' + ctrl.generatedId + '-' + activeIndex);
    }
  }

  function onDestroy() {
    ctrl.searchInput.off('keyup keydown tagged blur paste');
    angular.element($window).off('resize', onResize);
  }

  function onOpenChange(open) {
    if (!open) {
      $element.find('input').removeAttr('aria-activedescendant');
    }
  }
  //#endregion
}
