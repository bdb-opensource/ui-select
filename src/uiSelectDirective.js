uis.directive('uiSelect',
  ['$document', 'uiSelectConfig', 'uiSelectMinErr', 'uisOffset', '$parse', '$timeout', '$window',
  function($document, uiSelectConfig, uiSelectMinErr, uisOffset, $parse, $timeout, $window) {

  return {
    restrict: 'EA',
    templateUrl: function(tElement, tAttrs) {
      var theme = tAttrs.theme || uiSelectConfig.theme;
      return theme + (angular.isDefined(tAttrs.multiple) ? '/select-multiple.tpl.html' : '/select.tpl.html');
    },
    replace: true,
    transclude: true,
    require: ['uiSelect', '^ngModel', '?^^fieldset'],
    scope: true,

    controller: 'uiSelectCtrl',
    controllerAs: '$select',
    compile: function(tElement, tAttrs) {

      // Allow setting ngClass on uiSelect
      var match = /{(.*)}\s*{(.*)}/.exec(tAttrs.ngClass);
      if(match) {
        var combined = '{'+ match[1] +', '+ match[2] +'}';
        tAttrs.ngClass = combined;
        tElement.attr('ng-class', combined);
      }

      //Multiple or Single depending if multiple attribute presence
      if (angular.isDefined(tAttrs.multiple))
        tElement.append('<ui-select-multiple/>').removeAttr('multiple');
      else
        tElement.append('<ui-select-single/>');

      if (tAttrs.inputId)
        tElement.querySelectorAll('input.ui-select-search')[0].id = tAttrs.inputId;

      return function(scope, element, attrs, ctrls, transcludeFn) {
        var $select = ctrls[0];
        var ngModel = ctrls[1];
        var $fieldset = ctrls[2];

        var documentElement = $document[0].documentElement;
        var dropdown; // Hold on to a reference to the .ui-select-dropdown element for direction support.
        var originalWidth = '';
        var placeholder = null; // Hold on to a reference to the .ui-select-container element for appendToBody support

        // Support for appending the select field to the body when its open
        var appendToBody = scope.$eval(attrs.appendToBody);
        if (appendToBody === undefined) {
          appendToBody = uiSelectConfig.appendToBody;
        }

        $select.generatedId = uiSelectConfig.generateId();
        $select.baseTitle = attrs.title || 'Select box';
        $select.focusserTitle = $select.baseTitle + ' focus';
        $select.focusserId = 'focusser-' + $select.generatedId;

        $select.closeOnSelect = function() {
          if (angular.isDefined(attrs.closeOnSelect)) {
            return $parse(attrs.closeOnSelect)();
          } else {
            return uiSelectConfig.closeOnSelect;
          }
        }();

        scope.$watch('skipFocusser', function() {
            var skipFocusser = scope.$eval(attrs.skipFocusser);
            $select.skipFocusser = skipFocusser !== undefined ? skipFocusser : uiSelectConfig.skipFocusser;
        });

        $select.onSelectCallback = $parse(attrs.onSelect);
        $select.onRemoveCallback = $parse(attrs.onRemove);

        //Set reference to ngModel from uiSelectCtrl
        $select.ngModel = ngModel;

        $select.choiceGrouped = function(group){
          return $select.isGrouped && group && group.name;
        };

        if(attrs.tabindex){
          attrs.$observe('tabindex', function(value) {
            $select.focusInput.attr('tabindex', value);
            element.removeAttr('tabindex');
          });
        }

        scope.$watch(function () { return scope.$eval(attrs.searchEnabled); }, function(newVal) {
          $select.searchEnabled = newVal !== undefined ? newVal : uiSelectConfig.searchEnabled;
        });

        scope.$watch('sortable', function() {
            var sortable = scope.$eval(attrs.sortable);
            $select.sortable = sortable !== undefined ? sortable : uiSelectConfig.sortable;
        });

        attrs.$observe('backspaceReset', function() {
          // $eval() is needed otherwise we get a string instead of a boolean
          var backspaceReset = scope.$eval(attrs.backspaceReset);
          $select.backspaceReset = backspaceReset !== undefined ? backspaceReset : true;
        });

        attrs.$observe('limit', function() {
          //Limit the number of selections allowed
          $select.limit = (angular.isDefined(attrs.limit)) ? parseInt(attrs.limit, 10) : undefined;
        });

        scope.$watch('removeSelected', function() {
            var removeSelected = scope.$eval(attrs.removeSelected);
            $select.removeSelected = removeSelected !== undefined ? removeSelected : uiSelectConfig.removeSelected;
        });

        // If the disable attribute is applied, or a parent fieldset becomes disabled, disable the select.
        scope.$watch(function() { return element.attr('disabled') || $fieldset && $fieldset.isDisabled(); }, function(disabled) {
          $select.disabled = disabled;
        });

        attrs.$observe('resetSearchInput', function() {
          // $eval() is needed otherwise we get a string instead of a boolean
          var resetSearchInput = scope.$eval(attrs.resetSearchInput);
          $select.resetSearchInput = resetSearchInput !== undefined ? resetSearchInput : true;
        });

        attrs.$observe('paste', function() {
          $select.paste = scope.$eval(attrs.paste);
        });

        attrs.$observe('tagging', function() {
          if(attrs.tagging !== undefined)
          {
            // $eval() is needed otherwise we get a string instead of a boolean
            var taggingEval = scope.$eval(attrs.tagging);
            $select.tagging = {isActivated: true, fct: taggingEval !== true ? taggingEval : undefined};
          }
          else
          {
            $select.tagging = {isActivated: false, fct: undefined};
          }
        });

        attrs.$observe('taggingLabel', function() {
          if(attrs.tagging !== undefined )
          {
            // check eval for FALSE, in this case, we disable the labels
            // associated with tagging
            if ( attrs.taggingLabel === 'false' ) {
              $select.taggingLabel = false;
            }
            else
            {
              $select.taggingLabel = attrs.taggingLabel !== undefined ? attrs.taggingLabel : '(new)';
            }
          }
        });

        attrs.$observe('taggingTokens', function() {
          if (attrs.tagging !== undefined) {
            var tokens = attrs.taggingTokens !== undefined ? attrs.taggingTokens.split('|') : [',','ENTER'];
            $select.taggingTokens = {isActivated: true, tokens: tokens };
          }
        });

        attrs.$observe('spinnerEnabled', function() {
          // $eval() is needed otherwise we get a string instead of a boolean
          var spinnerEnabled = scope.$eval(attrs.spinnerEnabled);
          $select.spinnerEnabled = spinnerEnabled !== undefined ? spinnerEnabled : uiSelectConfig.spinnerEnabled;
        });

        attrs.$observe('spinnerClass', function() {
          var spinnerClass = attrs.spinnerClass;
          $select.spinnerClass = spinnerClass !== undefined ? attrs.spinnerClass : uiSelectConfig.spinnerClass;
        });

        // Keep track of whether or not this field is required, if it is, do not allow it to be cleared.
        scope.$watch(
          function() { return !!scope.$eval(attrs.ngRequired); },
          function(required, oldRequired) {
            $select.required = required;
            $select.refreshItems();
          }
        );

        //Automatically gets focus when loaded
        if (angular.isDefined(attrs.autofocus)) {
          resetFocus();
        }

        //Gets focus based on scope event name (e.g. focus-on='SomeEventName')
        if (angular.isDefined(attrs.focusOn)) {
          scope.$on(attrs.focusOn, resetFocus);
        }

        // Move transcluded elements to their correct position in main template
        transcludeFn(scope, function(clone) {
          // See Transclude in AngularJS http://blog.omkarpatil.com/2012/11/transclude-in-angularjs.html

          // One day jqLite will be replaced by jQuery and we will be able to write:
          // var transcludedElement = clone.filter('.my-class')
          // instead of creating a hackish DOM element:
          var transcluded = angular.element('<div>').append(clone);

          var transcludedMatch = transcluded.querySelectorAll('.ui-select-match');
          transcludedMatch.removeAttr('ui-select-match'); //To avoid loop in case directive as attr
          transcludedMatch.removeAttr('data-ui-select-match'); // Properly handle HTML5 data-attributes
          if (transcludedMatch.length !== 1) {
            throw uiSelectMinErr('transcluded', "Expected 1 .ui-select-match but got '{0}'.", transcludedMatch.length);
          }
          element.querySelectorAll('.ui-select-match').replaceWith(transcludedMatch);

          var transcludedChoices = transcluded.querySelectorAll('.ui-select-choices');
          transcludedChoices.removeAttr('ui-select-choices'); //To avoid loop in case directive as attr
          transcludedChoices.removeAttr('data-ui-select-choices'); // Properly handle HTML5 data-attributes
          if (transcludedChoices.length !== 1) {
            throw uiSelectMinErr('transcluded', "Expected 1 .ui-select-choices but got '{0}'.", transcludedChoices.length);
          }
          element.querySelectorAll('.ui-select-choices').replaceWith(transcludedChoices);

          var transcludedNoChoice = transcluded.querySelectorAll('.ui-select-no-choice');
          transcludedNoChoice.removeAttr('ui-select-no-choice'); //To avoid loop in case directive as attr
          transcludedNoChoice.removeAttr('data-ui-select-no-choice'); // Properly handle HTML5 data-attributes
          if (transcludedNoChoice.length == 1) {
            element.querySelectorAll('.ui-select-no-choice').replaceWith(transcludedNoChoice);
          }

          var transcludedHeader = transcluded.querySelectorAll('.ui-select-header');
          transcludedHeader.removeAttr('ui-select-header'); // To avoid loop in case directive as attr
          transcludedHeader.removeAttr('data-ui-select-header'); // Properly handle HTML5 data-attributes
          if (transcludedHeader.length == 1) {
            element.querySelectorAll('.ui-select-header').replaceWith(transcludedHeader);
          } else {
            element.querySelectorAll('.ui-select-header').remove();
          }

          var transcludedFooter = transcluded.querySelectorAll('.ui-select-footer');
          transcludedFooter.removeAttr('ui-select-footer'); // To avoid loop in case directive as attr
          transcludedFooter.removeAttr('data-ui-select-footer'); // Properly handle HTML5 data-attributes
          if (transcludedFooter.length == 1) {
            element.querySelectorAll('.ui-select-footer').replaceWith(transcludedFooter);
          } else {
            element.querySelectorAll('.ui-select-footer').remove();
          }
        });

        scope.$watch('$select.open', function(isOpen) {
          if (isOpen) {
            // Attach global handlers that cause the dropdowns to close
            $window.addEventListener('mousedown', closeOnClick, true);
            $window.addEventListener('scroll', closeOnScroll, true);
            $window.addEventListener('resize', closeOnResize, true);

            if (appendToBody) {
              // Wait for ui-select-match child directive, it hasn't started rendering yet.
              scope.$evalAsync(positionDropdown);
            }
          } else {
            resetDropdown();
          }

          // Support changing the direction of the dropdown if there isn't enough space to render it.
          scope.calculateDropdownPos();
        });

        // Move the dropdown back to its original location when the scope is destroyed. Otherwise
        // it might stick around when the user routes away or the select field is otherwise removed
        scope.$on('$destroy', resetDropdown);

        scope.calculateDropdownPos = function() {
          dropdown = dropdown || ($select.open && angular.element(element).querySelectorAll('.ui-select-dropdown'));
          if (!dropdown || !dropdown.length) { return; }

          if ($select.open) {
            setDropdownPosition('auto', $select.dropdownPosition);
          }
        };

        function calculateSelectLeftPosition(offset) {
          var scrollLeft = documentElement.scrollLeft || $document[0].body.scrollLeft;
          var edgeOffscreenAmount = (offset.left + offset.width) - (scrollLeft + documentElement.clientWidth);
          var paddingFromEdge = 30;

          var leftPosition = offset.left;
          if (edgeOffscreenAmount > 0) {
            leftPosition -= (edgeOffscreenAmount + paddingFromEdge);
          }

          return leftPosition;
        }

        function closeOnClick(e) {
          if (!$select.open) return; //Skip it if dropdown is close

          var contains = false;
          var target = e.target || e.srcElement;

          if (window.jQuery) {
            // Firefox 3.6 does not support element.contains()
            // See Node.contains https://developer.mozilla.org/en-US/docs/Web/API/Node.contains
            contains = window.jQuery.contains(element[0], target);
          } else {
            contains = element[0].contains(target);
          }
          if (!contains && !$select.clickTriggeredSelect) {
            var skipFocusser;
            if (!$select.skipFocusser) {
              //Will lose focus only with certain targets
              var focusableControls = ['input','button','textarea','select'];
              var targetController = angular.element(target).controller('uiSelect'); //To check if target is other ui-select
              skipFocusser = targetController && targetController !== $select; //To check if target is other ui-select
              if (!skipFocusser) skipFocusser =  ~focusableControls.indexOf(target.tagName.toLowerCase()); //Check if target is input, button or textarea
            } else {
              skipFocusser = true;
            }

            $select.close(skipFocusser);
            scope.$digest();
          }
          $select.clickTriggeredSelect = false;
        }

        function closeOnResize() {
          $select.close(false);
        }

        function closeOnScroll(e) {
          if (!element[0].contains(e.target || e.srcElement)) {
            $select.close(false);
          }
        }

        function positionDropdown() {
          // Remember the absolute position of the element
          var offset = uisOffset(element);

          // Clone the element into a placeholder element to take its original place in the DOM
          placeholder = angular.element('<div class="ui-select-placeholder"></div>');
          placeholder[0].style.width = offset.width + 'px';
          placeholder[0].style.height = offset.height + 'px';
          element.after(placeholder);

          // Remember the original value of the element width inline style, so it can be restored
          // when the dropdown is closed
          originalWidth = element[0].style.width;
          element[0].style.position = 'absolute';
          element[0].style.left = calculateSelectLeftPosition(offset) + 'px';
          element[0].style.top = offset.top + 'px';
          element[0].style.width = offset.width + 'px';
          $document[0].body.appendChild(element[0]);
        }

        function resetDropdown() {
          $window.removeEventListener('mousedown', closeOnClick, true);
          $window.removeEventListener('scroll', closeOnResize, true);
          $window.removeEventListener('resize', resetDropdown, true);

          // Move the dropdown element back to its original location in the DOM if we moved it.
          if (placeholder) {
            element[0].style.position = '';
            element[0].style.left = '';
            element[0].style.top = '';
            element[0].style.width = originalWidth;
            placeholder.replaceWith(element);
            placeholder = null;
            resetFocus();
          }
        }

        function resetFocus() {
          $timeout(function(){
            $select.setFocus();
          });
        }

        function setDropdownPosition(xState, yState) {
          var offset = uisOffset(element);
          var offsetDropdown = uisOffset(dropdown);
          var scrollTarget = documentElement || $document[0].body;
          var position, top;
          element.removeClass('direction-up dropdown-menu-right');

          if (yState === 'up' || (yState === 'auto' && offset.top + offset.height + offsetDropdown.height - scrollTarget.scrollTop > documentElement.clientHeight)) {
            element.addClass('direction-up');
            position = 'absolute';
            top = (offsetDropdown.height * -1) + 'px';
          } else {
            position = '';
            top = '';
          }

          dropdown[0].style.position = position;
          dropdown[0].style.top = top;
          dropdown.toggleClass('dropdown-menu-right', xState === 'right' ||
            (xState === 'auto' && offset.left + offsetDropdown.width - scrollTarget.scrollLeft > documentElement.clientWidth)
          );
        }
      };
    }
  };
}]);
